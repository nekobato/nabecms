type SemverIdentifier = number | string;

type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly SemverIdentifier[];
};

type ComparatorOperator = "=" | ">" | ">=" | "<" | "<=";

type Comparator = {
  operator: ComparatorOperator;
  version: Semver;
};

type RangeClause = readonly Comparator[];

type VersionRange = readonly RangeClause[];

const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/u;
const SEMVER_PATTERN =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

/**
 * Parse a semver identifier into either a numeric or string token.
 */
const parseIdentifier = (value: string): SemverIdentifier =>
  NUMERIC_IDENTIFIER_PATTERN.test(value) ? Number(value) : value;

/**
 * Parse an exact semver string.
 */
const parseSemver = (value: string): Semver | null => {
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match?.groups) return null;

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    prerelease: match.groups.prerelease
      ? match.groups.prerelease.split(".").map(parseIdentifier)
      : [],
  };
};

/**
 * Compare two prerelease identifier lists using semver precedence rules.
 */
const comparePrerelease = (
  left: readonly SemverIdentifier[],
  right: readonly SemverIdentifier[],
): number => {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    if (typeof leftPart === "number" && typeof rightPart === "number") {
      return leftPart > rightPart ? 1 : -1;
    }
    if (typeof leftPart === "number") return -1;
    if (typeof rightPart === "number") return 1;
    return leftPart > rightPart ? 1 : -1;
  }

  return 0;
};

/**
 * Compare two semver values.
 */
const compareSemver = (left: Semver, right: Semver): number => {
  if (left.major !== right.major) return left.major > right.major ? 1 : -1;
  if (left.minor !== right.minor) return left.minor > right.minor ? 1 : -1;
  if (left.patch !== right.patch) return left.patch > right.patch ? 1 : -1;
  return comparePrerelease(left.prerelease, right.prerelease);
};

/**
 * Convert a comparator and operand into a predicate result.
 */
const compareWithOperator = (
  version: Semver,
  comparator: Comparator,
): boolean => {
  const result = compareSemver(version, comparator.version);

  switch (comparator.operator) {
    case "=":
      return result === 0;
    case ">":
      return result > 0;
    case ">=":
      return result >= 0;
    case "<":
      return result < 0;
    case "<=":
      return result <= 0;
  }
};

/**
 * Create the exclusive upper bound used by caret ranges.
 */
const caretUpperBound = (version: Semver): Semver => {
  if (version.major > 0) {
    return { major: version.major + 1, minor: 0, patch: 0, prerelease: [] };
  }
  if (version.minor > 0) {
    return { major: 0, minor: version.minor + 1, patch: 0, prerelease: [] };
  }
  return {
    major: 0,
    minor: 0,
    patch: version.patch + 1,
    prerelease: [],
  };
};

/**
 * Create the exclusive upper bound used by tilde ranges.
 */
const tildeUpperBound = (version: Semver): Semver => ({
  major: version.major,
  minor: version.minor + 1,
  patch: 0,
  prerelease: [],
});

/**
 * Parse a single comparator token into one or more concrete comparators.
 */
const parseComparatorToken = (token: string): readonly Comparator[] | null => {
  const trimmed = token.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("^")) {
    const version = parseSemver(trimmed.slice(1));
    if (!version) return null;
    return [
      { operator: ">=", version },
      { operator: "<", version: caretUpperBound(version) },
    ];
  }

  if (trimmed.startsWith("~")) {
    const version = parseSemver(trimmed.slice(1));
    if (!version) return null;
    return [
      { operator: ">=", version },
      { operator: "<", version: tildeUpperBound(version) },
    ];
  }

  const comparatorPrefixes = [">=", "<=", ">", "<", "="] as const;
  const prefix = comparatorPrefixes.find((candidate) =>
    trimmed.startsWith(candidate),
  );

  if (prefix) {
    const version = parseSemver(trimmed.slice(prefix.length));
    if (!version) return null;
    return [{ operator: prefix, version }];
  }

  const version = parseSemver(trimmed);
  if (!version) return null;
  return [{ operator: "=", version }];
};

/**
 * Parse a supported semver range expression.
 */
export const parseVersionRange = (value: string): VersionRange | null => {
  const clauses = value
    .split("||")
    .map((clause) => clause.trim())
    .filter(Boolean);

  if (clauses.length === 0) return null;

  const parsed = clauses.map((clause) => {
    const tokens = clause.split(/\s+/u).filter(Boolean);
    if (tokens.length === 0) return null;

    const comparators: Comparator[] = [];
    for (const token of tokens) {
      const parsedToken = parseComparatorToken(token);
      if (!parsedToken) return null;
      comparators.push(...parsedToken);
    }

    return comparators;
  });

  if (parsed.some((clause) => clause === null)) return null;
  return parsed as VersionRange;
};

/**
 * Check whether a version satisfies a supported semver range expression.
 */
export const versionSatisfiesRange = (
  version: string,
  range: string,
): boolean => {
  const parsedVersion = parseSemver(version);
  const parsedRange = parseVersionRange(range);
  if (!parsedVersion || !parsedRange) return false;

  return parsedRange.some((clause) =>
    clause.every((comparator) =>
      compareWithOperator(parsedVersion, comparator),
    ),
  );
};
