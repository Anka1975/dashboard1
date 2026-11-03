const { test } = require("node:test");
const assert = require("node:assert/strict");
const engine = require("./roadmap-engine.js");
const months = engine.monthsFrom(new Date(2026, 0, 10));
function fixture() {
  const capacity = Object.fromEntries(months.map((month) => {
    const current = new Date(month + "-01T00:00:00Z");
    return [month, new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate()];
  }));
  const item = (id) => ({
    id, name: id, team: "team", start: "2026-01-01", fixed: false, deadline: "",
    estimates: { skill: { min: 2, max: 2 } }
  });
  return {
    skills: [{ id: "skill", name: "Programowanie" }],
    teams: [{ id: "team", name: "Alfa", skills: ["skill"], capacity: { skill: capacity } }],
    initiatives: [
      { id: "a", name: "A", skills: ["skill"], items: [item("a1")] },
      { id: "b", name: "B", skills: ["skill"], items: [item("b1")] }
    ]
  };
}
test("12 miesięcy obejmuje zmianę roku i rok przestępny", () => {
  const months = engine.monthsFrom(new Date(2027, 11, 15));
  assert.equal(months[0], "2027-12");
  assert.equal(months.at(-1), "2028-11");
  assert.equal(engine.horizon(months).days, 366);
});
test("współdzielone capacity jest zużywane tylko raz, zgodnie z priorytetem", () => {
  const results = engine.simulate(fixture(), months, 10);
  assert.equal(results[0].start50, 0);
  assert.equal(results[0].end85, 1);
  assert.equal(results[1].start50, 2);
  assert.equal(results[1].end85, 3);
});
test("niezależne zespoły pracują równolegle", () => {
  const plan = fixture();
  plan.teams.push({ ...structuredClone(plan.teams[0]), id: "second" });
  plan.initiatives[1].items[0].team = "second";
  assert.deepEqual(engine.simulate(plan, months, 1).map((result) => result.end85), [1, 1]);
});
test("elementy inicjatywy pracują kolejno, nie przed zadanym startem", () => {
  const plan = fixture();
  const item = { ...structuredClone(plan.initiatives[0].items[0]), id: "a2", start: "2026-01-10" };
  plan.initiatives[0].items.push(item);
  const results = engine.simulate(plan, months, 1);
  assert.equal(results[1].start50, 9);
  assert.equal(results[1].end85, 10);
});
test("kompetencje pracują równolegle i element czeka na najwolniejszą", () => {
  const plan = fixture();
  plan.skills.push({ id: "qa", name: "QA" });
  plan.teams[0].skills.push("qa");
  plan.teams[0].capacity.qa = structuredClone(plan.teams[0].capacity.skill);
  plan.initiatives[0].skills.push("qa");
  plan.initiatives[0].items[0].estimates.qa = { min: 5, max: 5 };
  const result = engine.simulate(plan, months, 1)[0];
  assert.equal(result.end85, 4);
});
test("fixed date mierzy ryzyko, nie obcina prognozy", () => {
  const plan = fixture();
  Object.assign(plan.initiatives[0].items[0], { fixed: true, deadline: "2026-01-01" });
  Object.assign(plan.initiatives[1].items[0], { fixed: true, deadline: "2026-01-04" });
  const results = engine.simulate(plan, months, 10);
  assert.equal(results[0].deadlineChance, 0);
  assert.equal(results[0].end85, 1);
  assert.equal(results[1].deadlineChance, 1);
});
test("brak capacity nie daje fikcyjnej daty ukończenia", () => {
  const plan = fixture();
  plan.teams[0].capacity.skill = Object.fromEntries(months.map((month) => [month, 0]));
  const results = engine.simulate(plan, months, 10);
  assert.equal(results[0].end85, Infinity);
  assert.equal(results[0].start50, Infinity);
  assert.equal(results[0].completion, 0);
});
test("capacity miesięczne uwzględnia długość miesiąca i dostępność od późniejszego miesiąca", () => {
  const plan = fixture();
  plan.teams[0].capacity.skill["2026-01"] = 0;
  assert.equal(engine.simulate(plan, months, 1)[0].end85, 32);
  plan.teams[0].capacity.skill["2026-02"] = 14;
  assert.equal(engine.simulate(plan, months, 1)[0].end85, 34);
});
test("P85 ma dokładny próg i uwzględnia nieukończone przebiegi", () => {
  const plan = fixture();
  plan.initiatives[0].items[0].estimates.skill = { min: 1, max: 1000 };
  let draws = 0;
  const random = () => {
    const run = Math.floor(draws++ / 2);
    return run < 17 ? 0 : 1;
  };
  const result = engine.simulate(plan, months, 20, random)[0];
  assert.equal(result.end85, 0);
  assert.equal(result.completion, 0.85);
  draws = 0;
  const censored = engine.simulate(plan, months, 20, () => Math.floor(draws++ / 2) < 16 ? 0 : 1)[0];
  assert.equal(censored.end85, Infinity);
  assert.equal(censored.completion, 0.8);
});
test("jednostajne losowanie daje oczekiwaną datę P85", () => {
  const plan = fixture();
  plan.initiatives[0].items[0].estimates.skill = { min: 1, max: 101 };
  let draws = 0;
  const result = engine.simulate(plan, months, 100, () => Math.floor(draws++ / 2) / 100)[0];
  assert.equal(result.end85, 84);
});
test("błędne dane wejściowe blokują symulację z komunikatem", () => {
  const plan = fixture();
  plan.teams[0].skills = [];
  plan.initiatives[0].items[0].estimates.skill = { min: 5, max: 1 };
  plan.initiatives[1].items[0].start = "2026-02-30";
  const errors = engine.validate(plan, months).join(" ");
  assert.match(errors, /kompetencjami/);
  assert.match(errors, /min ≤ max/);
  assert.match(errors, /data startu/);
  assert.throws(() => engine.simulate(plan, months), /kompetencjami/);
});
test("brakujące capacity, ujemne wartości i daty poza horyzontem są błędami", () => {
  const plan = fixture();
  delete plan.teams[0].capacity.skill["2026-01"];
  plan.teams[0].capacity.skill["2026-02"] = -1;
  plan.initiatives[0].items[0].start = "2027-01-01";
  assert.equal(engine.validate(plan, months).length, 3);
});
