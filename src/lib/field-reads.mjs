// Records which fields a pure function reads from a plain-data input — the
// test half of a field contract (business-snapshot-core SNAPSHOT_RAW_FIELDS):
// run the function on a Proxy of a fixture, collect every property path it
// touched, and compare with the declared list and the fixture's shape.
//
// Paths are dotted, an array element is "[]": "cur.locales.chats[].count".
// Array internals (length, map, …) and symbols are not recorded. Test-only.

/**
 * Wrap `root` so every property read is recorded.
 * @template T
 * @param {T} root
 * @returns {{ proxy: T, paths: Set<string> }}
 */
export function recordFieldReads(root) {
  /** @type {Set<string>} */
  const paths = new Set();
  /** @type {WeakMap<object, Map<string, any>>} */
  const cache = new WeakMap();
  const wrap = (value, path) => {
    if (value === null || typeof value !== "object") return value;
    let byPath = cache.get(value);
    if (!byPath) cache.set(value, (byPath = new Map()));
    if (byPath.has(path)) return byPath.get(path);
    const proxy = new Proxy(value, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof prop === "symbol") return v;
        if (Array.isArray(target)) return /^\d+$/.test(prop) ? wrap(v, `${path}[]`) : v;
        const p = path ? `${path}.${prop}` : prop;
        paths.add(p);
        return wrap(v, p);
      },
    });
    byPath.set(path, proxy);
    return proxy;
  };
  return { proxy: /** @type {T} */ (wrap(root, "")), paths };
}

/**
 * Whether `obj` has the dotted `path` ("a.b[].c"): every key on the way must
 * exist (the last value may be null); for "[]" at least one element must have
 * the rest.
 * @param {unknown} obj
 * @param {string} path
 * @returns {boolean}
 */
export function hasFieldPath(obj, path) {
  const segments = path.replace(/\[\]/g, ".[]").split(".").filter(Boolean);
  /** @param {unknown} value @param {number} i @returns {boolean} */
  const walk = (value, i) => {
    if (i === segments.length) return true;
    const seg = segments[i];
    if (seg === "[]") return Array.isArray(value) && value.some((el) => walk(el, i + 1));
    if (value === null || typeof value !== "object" || Array.isArray(value) || !(seg in value)) return false;
    return walk(/** @type {Record<string, unknown>} */ (value)[seg], i + 1);
  };
  return walk(obj, 0);
}
