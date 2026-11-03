const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const vm = require("node:vm");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const key = "dashboard-roadmap-v1";

async function setup(overrides = {}, initialStorage) {
  const elements = new Map();
  const storage = new Map(initialStorage === undefined ? [] : [[key, initialStorage]]);
  const windowListeners = {};
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      id, disabled: false, hidden: false, inert: false, dataset: {},
      textContent: "", innerHTML: "", listeners: {},
      addEventListener(name, handler) { this.listeners[name] = handler; }
    });
    return elements.get(id);
  };
  let onUser;
  const writes = [];
  const cloud = {
    connect: (callback) => { onUser = callback; },
    login: async () => {},
    logout: async () => onUser(null),
    load: async () => ({ plan: null, revision: 0 }),
    save: async (uid, plan, revision) => { writes.push({ uid, plan, revision }); return revision + 1; },
    ...overrides
  };
  const context = vm.createContext({
    crypto: { randomUUID }, console, setTimeout,
    document: { getElementById: element },
    localStorage: { getItem: (id) => storage.get(id) ?? null, setItem: (id, value) => storage.set(id, value) },
    window: { addEventListener: (name, handler) => { windowListeners[name] = handler; } },
    confirm: () => true
  });
  vm.runInContext(readFileSync(`${__dirname}/roadmap-engine.js`, "utf8"), context);
  const module = new vm.SyntheticModule(Object.keys(cloud), function () {
    for (const [name, value] of Object.entries(cloud)) this.setExport(name, value);
  }, { context });
  await module.link(() => {});
  await module.evaluate();
  new vm.Script(readFileSync(`${__dirname}/roadmap.js`, "utf8"), {
    importModuleDynamically: async () => module
  }).runInContext(context);
  await tick();
  return {
    element, storage, writes, windowListeners,
    auth: async (user) => { await onUser(user); await tick(); },
    click: async (id) => { await element(id).listeners.click(); await tick(); },
    addTeam: () => element("roadmapPanel").listeners.click({
      target: { closest: () => element("addRoadmapTeam") }
    })
  };
}

test("tryb gościa zapisuje lokalnie, a konto nie importuje go automatycznie", async () => {
  const page = await setup();
  await page.auth(null);
  page.addTeam();
  const guest = page.storage.get(key);
  assert.equal(JSON.parse(guest).teams.length, 3);
  await page.auth({ uid: "alice" });
  assert.equal(page.writes.length, 1);
  assert.equal(page.writes[0].plan.teams.length, 2);
  assert.equal(page.storage.get(key), guest);
  await page.click("roadmapImport");
  assert.equal(page.writes.at(-1).plan.teams.length, 3);
  await page.click("roadmapLogout");
  assert.equal(page.element("roadmapEditor").inert, false);
  assert.equal(page.storage.get(key), guest);
});

test("błąd odczytu blokuje edycję i nie tworzy zapisu zastępczego", async () => {
  const page = await setup({ load: async () => { throw new Error("permission-denied"); } });
  await page.auth({ uid: "alice" });
  assert.equal(page.element("roadmapEditor").inert, true);
  assert.match(page.element("roadmapCloudStatus").textContent, /permission-denied/);
  assert.equal(page.writes.length, 0);
});

test("niepoprawny dokument z bazy nie jest nadpisywany", async () => {
  const page = await setup({ load: async () => ({ plan: {}, revision: 1 }) });
  await page.auth({ uid: "alice" });
  assert.equal(page.element("roadmapEditor").inert, true);
  assert.equal(page.writes.length, 0);
});

test("istniejący plan jest przywracany z bazy, bez kopiowania go do planu gościa", async () => {
  const seed = await setup();
  const remotePlan = JSON.parse(seed.storage.get(key));
  remotePlan.teams[0].name = "Prywatny zespol Alice";
  const page = await setup({ load: async () => ({ plan: remotePlan, revision: 7 }) });
  const guest = page.storage.get(key);
  await page.auth({ uid: "alice" });
  assert.match(page.element("roadmapTeams").innerHTML, /Prywatny zespol Alice/);
  assert.equal(page.writes.length, 0);
  page.addTeam();
  await tick();
  assert.equal(page.writes[0].revision, 7);
  assert.equal(page.storage.get(key), guest);
  await page.click("roadmapLogout");
  assert.doesNotMatch(page.element("roadmapTeams").innerHTML, /Prywatny zespol Alice/);
});

test("spóźniony odczyt innego konta nie przywraca jego prywatnego planu", async () => {
  let finishAlice;
  const page = await setup({
    load: async (uid) => {
      if (uid === "alice") return new Promise((resolve) => { finishAlice = resolve; });
      return { plan: null, revision: 0 };
    }
  });
  const alice = page.auth({ uid: "alice" });
  await page.auth({ uid: "bob" });
  finishAlice({ plan: {}, revision: 999 });
  await alice;
  assert.equal(page.element("roadmapEditor").inert, false);
  assert.match(page.element("roadmapCloudStatus").textContent, /bob/);
  assert.ok(page.writes.every((write) => write.uid === "bob"));
});

test("nieudany zapis jest widoczny, chroniony przy zamykaniu i ponawiany", async () => {
  let fail = true;
  const page = await setup({
    save: async (_, __, revision) => {
      if (fail) throw new Error("offline");
      return revision + 1;
    }
  });
  await page.auth({ uid: "alice" });
  assert.match(page.element("roadmapCloudStatus").textContent, /Nie zapisano.*offline/);
  assert.equal(page.element("roadmapRetry").hidden, false);
  let prevented = false;
  page.windowListeners.beforeunload({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  await page.click("roadmapLogout");
  assert.equal(page.element("roadmapLogout").hidden, false);
  fail = false;
  await page.click("roadmapRetry");
  assert.match(page.element("roadmapCloudStatus").textContent, /Zapisano/);
  assert.equal(page.element("roadmapRetry").hidden, true);
});

test("zmiany podczas zapisu są kolejkowane z kolejną wersją", async () => {
  let finish;
  const writes = [];
  const page = await setup({
    save: async (_, plan, revision) => {
      writes.push({ plan, revision });
      if (writes.length === 1) await new Promise((resolve) => { finish = resolve; });
      return revision + 1;
    }
  });
  await page.auth({ uid: "alice" });
  page.addTeam();
  page.addTeam();
  assert.equal(writes.length, 1);
  finish();
  await tick();
  assert.equal(writes.length, 2);
  assert.equal(writes[1].revision, 1);
  assert.equal(writes[1].plan.teams.length, 4);
});

test("opóźniony zapis poprzedniego konta nie zmienia wersji nowego konta", async () => {
  let finishAlice;
  const writes = [];
  const page = await setup({
    save: async (uid, plan, revision) => {
      writes.push({ uid, revision });
      if (uid === "alice") await new Promise((resolve) => { finishAlice = resolve; });
      return revision + 1;
    }
  });
  await page.auth({ uid: "alice" });
  await page.auth({ uid: "bob" });
  finishAlice();
  await tick();
  page.addTeam();
  await tick();
  assert.equal(writes.at(-1).uid, "bob");
  assert.equal(writes.at(-1).revision, 1);
});

test("uszkodzony plan lokalny nie jest nadpisywany i nie blokuje konta", async () => {
  const page = await setup({}, "{broken");
  await page.auth(null);
  assert.equal(page.element("roadmapEditor").inert, true);
  assert.equal(page.storage.get(key), "{broken");
  await page.auth({ uid: "alice" });
  assert.equal(page.element("roadmapEditor").inert, false);
  assert.equal(page.storage.get(key), "{broken");
  assert.equal(page.writes.length, 1);
});
