// Mo's insights as Shopify customer tags (pure, tested) — plan D-11. Every
// tag Mo owns starts with `mo-`; tags without the prefix (the shop's own) are
// never touched. The nightly job compares the desired set with the person's
// current `mo-` tags and queues the difference as one `writeback` outbox row.
//
//   mo-segment-<lifecycle segment>   e.g. mo-segment-zurueckholen
//   mo-wert-<value tier>             mo-wert-grossgeraet
//   mo-kontakt                       talked to Mo at least once
//   mo-abwanderung-hoch              churn risk high
//
// An Art. 21 objection to profiling (customers.profile_objection_at) means no
// tags at all: every `mo-` tag is removed and none is added again.

export const MO_TAG_PREFIX = "mo-";

/**
 * @param {{ lifecycleSegment?: string | null, valueTier?: string | null,
 *           conversationsCount?: number, churnRisk?: string | null,
 *           profileObjection?: boolean }} facts
 * @returns {string[]} sorted
 */
export function desiredMoTags(facts) {
  const tags = [];
  if (facts?.profileObjection) return tags;
  const clean = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (facts?.lifecycleSegment && clean(facts.lifecycleSegment)) tags.push(`mo-segment-${clean(facts.lifecycleSegment)}`);
  if (facts?.valueTier && clean(facts.valueTier)) tags.push(`mo-wert-${clean(facts.valueTier)}`);
  if (Number(facts?.conversationsCount ?? 0) > 0) tags.push("mo-kontakt");
  if (facts?.churnRisk === "hoch") tags.push("mo-abwanderung-hoch");
  return tags.sort();
}

/**
 * What to add and remove so the person's `mo-` tags equal `desired`.
 * @param {string[] | null | undefined} current all Shopify tags of the person
 * @param {string[]} desired
 * @returns {{ add: string[], remove: string[], changed: boolean }}
 */
export function moTagDiff(current, desired) {
  const have = new Set((current ?? []).map((t) => String(t).trim()).filter((t) => t.toLowerCase().startsWith(MO_TAG_PREFIX)));
  const want = new Set(desired);
  const add = [...want].filter((t) => !have.has(t)).sort();
  const remove = [...have].filter((t) => !want.has(t)).sort();
  return { add, remove, changed: add.length + remove.length > 0 };
}
