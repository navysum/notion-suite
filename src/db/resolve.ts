import { DatabaseRow, DatabaseSchema, PropertyDef } from "../types";
import { computeRollup, indexByName, rollupRelationProperty } from "./rollup";
import { evaluateFormula } from "./value";

/**
 * Where the resolver gets its raw material. The store implements this against
 * the vault; tests implement it with fixtures.
 */
export interface ResolverSource {
	/** Look up a database by id (or name/folder, as the store allows). */
	schema(id: string): DatabaseSchema | undefined;
	/**
	 * Rows with frontmatter decoded but no derived values computed yet.
	 * Must return a fresh array each call -- the resolver mutates its copies.
	 */
	baseRows(schema: DatabaseSchema): DatabaseRow[];
}

/**
 * Turns base rows into fully resolved rows by filling in rollups and formulas.
 *
 * Rollups read rows from *other* databases, and those databases may roll up
 * back into this one. That makes the dependency graph a genuine cycle risk, so
 * resolution tracks what it is currently working on and, on re-entry, falls
 * back to the unresolved base rows instead of recursing forever.
 *
 * A cycle has no fixed point, so results touching one are computed to a single
 * level and deliberately not cached -- caching a partial answer would let it
 * leak into later, non-cyclic reads.
 */
export class RowResolver {
	private cache = new Map<string, DatabaseRow[]>();
	private resolving = new Set<string>();
	private sawCycle = false;

	constructor(private source: ResolverSource) {}

	clear(): void {
		this.cache.clear();
		this.resolving.clear();
		this.sawCycle = false;
	}

	rows(schema: DatabaseSchema): DatabaseRow[] {
		const cached = this.cache.get(schema.id);
		if (cached) return cached;

		// Re-entered while already resolving this database: this is the cycle.
		// Hand back the unresolved rows so the caller can finish.
		if (this.resolving.has(schema.id)) {
			this.sawCycle = true;
			return this.source.baseRows(schema);
		}

		const outermost = this.resolving.size === 0;
		if (outermost) this.sawCycle = false;

		this.resolving.add(schema.id);
		try {
			const rows = this.source.baseRows(schema);
			// Rollups first: a formula is allowed to reference a rollup's result,
			// but a rollup never reads a formula on its own row.
			this.resolveRollups(schema, rows);
			resolveFormulas(schema, rows);
			if (!this.sawCycle) this.cache.set(schema.id, rows);
			return rows;
		} finally {
			this.resolving.delete(schema.id);
		}
	}

	private resolveRollups(schema: DatabaseSchema, rows: DatabaseRow[]): void {
		const rollups = schema.properties.filter((p) => p.type === "rollup");
		if (rollups.length === 0) return;

		for (const def of rollups) {
			const relation = rollupRelationProperty(schema, def);
			const target = relation?.relationDatabaseId
				? this.source.schema(relation.relationDatabaseId)
				: undefined;

			if (!relation || !target) {
				// Misconfigured or pointing at a database that no longer exists.
				for (const row of rows) row.values[def.id] = null;
				continue;
			}

			// Build the title index once per rollup, not once per row.
			const index = indexByName(this.rows(target));
			for (const row of rows) {
				row.values[def.id] = computeRollup(def, row.values[relation.id], index);
			}
		}
	}
}

/** Fill in every formula property on a set of rows. */
export function resolveFormulas(schema: DatabaseSchema, rows: DatabaseRow[]): void {
	const formulas: PropertyDef[] = schema.properties.filter((p) => p.type === "formula");
	if (formulas.length === 0) return;
	for (const row of rows) {
		for (const def of formulas) {
			row.values[def.id] = def.formula
				? evaluateFormula(def.formula, row, schema.properties)
				: null;
		}
	}
}
