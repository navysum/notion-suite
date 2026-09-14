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
 * Two caches, because those two jobs pull in opposite directions:
 *
 * - `passMemo` lives for one top-level resolution and holds *everything*. It is
 *   what stops a diamond or a cycle re-walking the same database once per
 *   referring rollup, which is exponential in the depth of the graph.
 * - `cache` persists until `clear()` and holds only results that did not depend
 *   on a cycle. A cycle has no fixed point, so its results are computed to a
 *   single level; keeping them would let that partial answer leak into a later,
 *   unrelated read.
 */
export class RowResolver {
	private cache = new Map<string, DatabaseRow[]>();
	private passMemo = new Map<string, DatabaseRow[]>();
	private resolving = new Set<string>();
	/** Databases whose result in this pass depended on a cycle. */
	private tainted = new Set<string>();

	constructor(private source: ResolverSource) {}

	clear(): void {
		this.cache.clear();
		this.passMemo.clear();
		this.resolving.clear();
		this.tainted.clear();
	}

	/**
	 * Fully resolved rows for a database.
	 *
	 * The returned array may be shared with other callers, so treat it as
	 * read-only: sorting it in place or writing into `row.values` would corrupt
	 * every other view reading the same database.
	 */
	rows(schema: DatabaseSchema): DatabaseRow[] {
		const cached = this.cache.get(schema.id) ?? this.passMemo.get(schema.id);
		if (cached) return cached;

		// Re-entered while already resolving this database: this is the cycle.
		// Everything currently on the stack is now resting on an unresolved
		// answer, so none of it may be kept beyond this pass.
		if (this.resolving.has(schema.id)) {
			for (const id of this.resolving) this.tainted.add(id);
			this.tainted.add(schema.id);
			return this.source.baseRows(schema);
		}

		const outermost = this.resolving.size === 0;
		this.resolving.add(schema.id);
		try {
			const rows = this.source.baseRows(schema);
			// Rollups first: a formula is allowed to reference a rollup's result,
			// but a rollup never reads a formula on its own row.
			this.resolveRollups(schema, rows);
			resolveFormulas(schema, rows);

			this.passMemo.set(schema.id, rows);
			// Checked after the subtree resolved, since that is when taint appears.
			if (!this.tainted.has(schema.id)) this.cache.set(schema.id, rows);
			return rows;
		} finally {
			this.resolving.delete(schema.id);
			if (outermost) {
				this.passMemo.clear();
				this.tainted.clear();
			}
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
