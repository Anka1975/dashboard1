const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

async function setup(initialData) {
  let data = initialData;
  const writes = [];
  const paths = [];
  const context = vm.createContext({});
  const snapshot = () => ({ exists: () => data !== undefined, data: () => data });
  const dependencies = {
    "firebase-app.js": { initializeApp: (config) => config },
    "firebase-auth.js": {
      getAuth: () => ({}), GoogleAuthProvider: class {},
      onAuthStateChanged: () => {}, signInWithPopup: async () => {}, signOut: async () => {}
    },
    "firebase-firestore.js": {
      getFirestore: () => ({}),
      doc: (_, ...path) => { paths.push(path.join("/")); return path; },
      getDocFromServer: async () => snapshot(),
      serverTimestamp: () => "server-time",
      runTransaction: async (_, callback) => callback({
        get: async () => snapshot(),
        set: (_, value) => { data = value; writes.push(value); }
      })
    }
  };
  const module = new vm.SourceTextModule(readFileSync(`${__dirname}/roadmap-cloud.js`, "utf8"), { context });
  await module.link((specifier) => {
    const exports = dependencies[specifier.split("/").at(-1)];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return { api: module.namespace, writes, paths };
}

test("nowy plan jest przypisany do UID i zapisywany z wersją oraz czasem serwera", async () => {
  const { api, writes, paths } = await setup();
  const empty = await api.load("alice");
  assert.equal(empty.plan, null);
  assert.equal(empty.revision, 0);
  const plan = { skills: [], teams: [], initiatives: [] };
  assert.equal(await api.save("alice", plan, 0), 1);
  assert.ok(paths.every((path) => path === "users/alice/plans/roadmap"));
  assert.equal(writes[0].plan, plan);
  assert.equal(writes[0].schemaVersion, 1);
  assert.equal(writes[0].updatedAt, "server-time");
  assert.equal((await api.load("alice")).revision, 1);
});

test("kolejny zapis zwiększa wersję i nie nadpisuje nowszej wersji", async () => {
  const { api, writes } = await setup({ schemaVersion: 1, revision: 3, plan: {} });
  await assert.rejects(api.save("alice", {}, 2), /innym urządzeniu/);
  assert.equal(writes.length, 0);
  assert.equal(await api.save("alice", {}, 3), 4);
  assert.equal(writes.length, 1);
});

test("nieznana lub uszkodzona wersja dokumentu nie jest wczytywana", async () => {
  for (const data of [{ schemaVersion: 2, revision: 1 }, { schemaVersion: 1, revision: -1 }]) {
    const { api, writes } = await setup(data);
    await assert.rejects(api.load("alice"), /Nieobsługiwana wersja/);
    assert.equal(writes.length, 0);
  }
});
