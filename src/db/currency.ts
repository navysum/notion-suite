/**
 * Money.
 *
 * Number properties formatted as currency used to be hard-coded to a dollar
 * sign, which is wrong for most of the people using this and silently wrong at
 * that: a UK budget rendered as `$1,500` looks like a working number, not like
 * a bug. It is also not just the symbol -- where it goes, which separators are
 * used and how many decimals are conventional all differ, and `€1,500.00` is as
 * wrong in Germany as `$` is in Delhi.
 *
 * `Intl.NumberFormat` knows all of that, so the property stores an ISO code and
 * the formatting is left to the platform.
 */

/** The currencies offered in the property editor, in a sensible order. */
export const CURRENCIES: { code: string; label: string }[] = [
	{ code: "USD", label: "US dollar ($)" },
	{ code: "EUR", label: "Euro (€)" },
	{ code: "GBP", label: "Pound sterling (£)" },
	{ code: "JPY", label: "Japanese yen (¥)" },
	{ code: "CNY", label: "Chinese yuan (¥)" },
	{ code: "INR", label: "Indian rupee (₹)" },
	{ code: "AUD", label: "Australian dollar (A$)" },
	{ code: "CAD", label: "Canadian dollar (C$)" },
	{ code: "CHF", label: "Swiss franc (CHF)" },
	{ code: "SEK", label: "Swedish krona (kr)" },
	{ code: "NOK", label: "Norwegian krone (kr)" },
	{ code: "DKK", label: "Danish krone (kr)" },
	{ code: "PLN", label: "Polish złoty (zł)" },
	{ code: "CZK", label: "Czech koruna (Kč)" },
	{ code: "HUF", label: "Hungarian forint (Ft)" },
	{ code: "RON", label: "Romanian leu (lei)" },
	{ code: "TRY", label: "Turkish lira (₺)" },
	{ code: "RUB", label: "Russian rouble (₽)" },
	{ code: "UAH", label: "Ukrainian hryvnia (₴)" },
	{ code: "BRL", label: "Brazilian real (R$)" },
	{ code: "MXN", label: "Mexican peso (MX$)" },
	{ code: "ARS", label: "Argentine peso (ARS)" },
	{ code: "CLP", label: "Chilean peso (CLP)" },
	{ code: "COP", label: "Colombian peso (COP)" },
	{ code: "ZAR", label: "South African rand (R)" },
	{ code: "NGN", label: "Nigerian naira (₦)" },
	{ code: "KES", label: "Kenyan shilling (KSh)" },
	{ code: "EGP", label: "Egyptian pound (E£)" },
	{ code: "AED", label: "UAE dirham (AED)" },
	{ code: "SAR", label: "Saudi riyal (SAR)" },
	{ code: "ILS", label: "Israeli shekel (₪)" },
	{ code: "KRW", label: "South Korean won (₩)" },
	{ code: "SGD", label: "Singapore dollar (S$)" },
	{ code: "HKD", label: "Hong Kong dollar (HK$)" },
	{ code: "TWD", label: "New Taiwan dollar (NT$)" },
	{ code: "THB", label: "Thai baht (฿)" },
	{ code: "MYR", label: "Malaysian ringgit (RM)" },
	{ code: "IDR", label: "Indonesian rupiah (Rp)" },
	{ code: "PHP", label: "Philippine peso (₱)" },
	{ code: "VND", label: "Vietnamese dong (₫)" },
	{ code: "PKR", label: "Pakistani rupee (₨)" },
	{ code: "BDT", label: "Bangladeshi taka (৳)" },
	{ code: "LKR", label: "Sri Lankan rupee (Rs)" },
	{ code: "NZD", label: "New Zealand dollar (NZ$)" },
];

const CODES = new Set(CURRENCIES.map((entry) => entry.code));

/**
 * The currency to offer when a property does not name one.
 *
 * Taken from the machine's own locale, because someone in Manchester setting up
 * a budget means pounds, and making them pick from forty-four entries to say so
 * is a worse default than guessing right most of the time. Falls back to USD
 * when the locale says nothing useful.
 */
export function defaultCurrency(locale?: string): string {
	const tag = locale ?? guessLocale();
	const region = regionOf(tag);
	return (region && REGION_CURRENCY[region]) || "USD";
}

function guessLocale(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
	} catch {
		return "en-US";
	}
}

function regionOf(tag: string): string | null {
	const match = tag.match(/[-_]([A-Za-z]{2})\b/);
	return match ? match[1].toUpperCase() : null;
}

/** Enough of the world to make the default a good guess rather than a shrug. */
const REGION_CURRENCY: Record<string, string> = {
	GB: "GBP", IE: "EUR", US: "USD", CA: "CAD", AU: "AUD", NZ: "NZD",
	DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR",
	AT: "EUR", PT: "EUR", GR: "EUR", FI: "EUR", SK: "EUR", SI: "EUR",
	EE: "EUR", LV: "EUR", LT: "EUR", LU: "EUR", MT: "EUR", CY: "EUR",
	CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK",
	HU: "HUF", RO: "RON", TR: "TRY", RU: "RUB", UA: "UAH",
	IN: "INR", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR",
	CN: "CNY", JP: "JPY", KR: "KRW", TW: "TWD", HK: "HKD", SG: "SGD",
	TH: "THB", MY: "MYR", ID: "IDR", PH: "PHP", VN: "VND",
	BR: "BRL", MX: "MXN", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN",
	ZA: "ZAR", NG: "NGN", KE: "KES", EG: "EGP", GH: "GHS", MA: "MAD",
	AE: "AED", SA: "SAR", IL: "ILS", QA: "QAR", KW: "KWD",
};

/**
 * Format an amount in a currency.
 *
 * Decimals are shown only when the amount has them, so a round £419 reads as
 * `£419` rather than `£419.00` -- which is what a budget actually looks like --
 * while £419.50 keeps its pence. A currency that has no minor unit at all, like
 * the yen, gets none either way, and `Intl` knows which those are.
 */
export function formatCurrency(amount: number, code?: string, locale?: string): string {
	const currency = code && CODES.has(code) ? code : defaultCurrency(locale);
	const tag = locale ?? guessLocale();
	try {
		// Money shows either no decimals or all of them -- `$419.50`, never
		// `$419.5`. How many "all of them" is depends on the currency, and Intl
		// already knows: two for the dollar, none for the yen.
		const natural = new Intl.NumberFormat(tag, { style: "currency", currency })
			.resolvedOptions().maximumFractionDigits ?? 2;
		const digits = Number.isInteger(amount) ? 0 : natural;
		return new Intl.NumberFormat(tag, {
			style: "currency",
			currency,
			minimumFractionDigits: digits,
			maximumFractionDigits: digits,
		}).format(amount);
	} catch {
		// An unknown code, or a platform without full ICU data. Better a plain
		// number than an exception inside a table cell.
		return `${currency} ${amount.toLocaleString()}`;
	}
}
