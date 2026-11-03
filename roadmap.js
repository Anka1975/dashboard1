/* global RoadmapEngine */
(() => {
  "use strict";
  const engine = RoadmapEngine;
  const months = engine.monthsFrom();
  const storageKey = "dashboard-roadmap-v1";
  const panel = document.getElementById("roadmapPanel");
  const status = document.getElementById("roadmapStatus");
  const cloudStatus = document.getElementById("roadmapCloudStatus");
  const editor = document.getElementById("roadmapEditor");
  const loginButton = document.getElementById("roadmapLogin");
  const logoutButton = document.getElementById("roadmapLogout");
  const reloadButton = document.getElementById("roadmapReload");
  const retryButton = document.getElementById("roadmapRetry");
  const importButton = document.getElementById("roadmapImport");
  let cloud;
  let user = null;
  let cloudReady = false;
  let revision = 0;
  let pending = null;
  let saving = null;
  let session = 0;
  const uid = () => crypto.randomUUID();
  const today = () => {
    const now = new Date();
    return engine.iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  };
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  function newItem(team = "") {
    return { id: uid(), name: "Nowy element", team, start: today(), fixed: false, deadline: "", estimates: {} };
  }
  function sample() {
    const skills = [{ id: uid(), name: "Frontend" }, { id: uid(), name: "Backend" }];
    const teams = ["Zespół Alfa", "Zespół Beta"].map((name) => ({
      id: uid(), name, skills: skills.map((skill) => skill.id),
      capacity: Object.fromEntries(skills.map((skill) => [skill.id, Object.fromEntries(months.map((month) => [month, 20]))]))
    }));
    return {
      skills, teams,
      initiatives: ["Portal klienta", "Automatyzacja obsługi"].map((name, index) => {
        const item = newItem(teams[index].id);
        item.name = "Pierwsze wydanie";
        item.estimates = Object.fromEntries(skills.map((skill) => [skill.id, { min: 10, max: 30 }]));
        return { id: uid(), name, skills: skills.map((skill) => skill.id), items: [item] };
      })
    };
  }
  // Validate persisted structure before allowing editing; invalid storage is never overwritten.
  function isPlan(value) {
    const objects = (entries) => Array.isArray(entries) && entries.every((entry) => entry && typeof entry === "object");
    const strings = (entries) => Array.isArray(entries) && entries.every((entry) => typeof entry === "string");
    const record = (entry) => entry && typeof entry === "object" && !Array.isArray(entry);
    if (!value || !objects(value.skills) || !objects(value.teams) || !objects(value.initiatives)) return false;
    const entities = [...value.skills, ...value.teams, ...value.initiatives];
    if (!value.initiatives.every((initiative) => objects(initiative.items))) return false;
    entities.push(...value.initiatives.flatMap((initiative) => initiative.items));
    if (!entities.every((entry) => typeof entry.id === "string" && /^[a-zA-Z0-9_-]+$/.test(entry.id) && typeof entry.name === "string") ||
      new Set(entities.map((entry) => entry.id)).size !== entities.length) return false;
    const knownSkills = new Set(value.skills.map((skill) => skill.id));
    const validSkills = (entries) => strings(entries) && entries.every((id) => knownSkills.has(id)) && new Set(entries).size === entries.length;
    return value.teams.every((team) => validSkills(team.skills) && record(team.capacity) &&
      Object.values(team.capacity).every((capacity) => record(capacity) && Object.values(capacity).every((amount) => amount === null || typeof amount === "number"))) &&
      value.initiatives.every((initiative) => validSkills(initiative.skills) && initiative.items.every((item) =>
        typeof item.team === "string" && typeof item.start === "string" && typeof item.fixed === "boolean" &&
        typeof item.deadline === "string" && record(item.estimates) && Object.values(item.estimates).every((estimate) =>
          record(estimate) && ["min", "max"].every((key) => estimate[key] === null || typeof estimate[key] === "number"))));
  }
  let plan;
  let restored = false;
  let localReadError = false;
  let persistenceError = "";
  try {
    const saved = localStorage.getItem(storageKey);
    restored = Boolean(saved);
    plan = saved ? JSON.parse(saved) : sample();
    if (!isPlan(plan)) throw new Error("Niepoprawna struktura zapisanych danych.");
  } catch (error) {
    localReadError = true;
    persistenceError = `Nie można wczytać planu: ${error.message} Zapis nie został nadpisany.`;
    plan = sample();
  }
  function ensureCapacity() {
    for (const team of plan.teams) {
      for (const skill of team.skills) {
        team.capacity[skill] ??= {};
        for (const month of months) {
          if (!(month in team.capacity[skill])) team.capacity[skill][month] = 0;
        }
      }
    }
  }
  function save() {
    if (user) {
      if (!cloudReady) return;
      pending = JSON.parse(JSON.stringify(plan));
      void flushCloud();
      return;
    }
    if (localReadError) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(plan));
      persistenceError = "";
    } catch (error) {
      persistenceError = `Nie udało się zapisać danych w przeglądarce: ${error.message}`;
    }
  }
  function stale() {
    document.getElementById("roadmapResults").textContent = "Dane zmienione — przelicz prognozę.";
    status.textContent = persistenceError || (user
      ? "Dane zmienione. Stan zapisu w Firebase jest widoczny powyżej. Prognoza wymaga przeliczenia."
      : "Dane zapisane lokalnie w tej przeglądarce. Prognoza wymaga przeliczenia.");
  }
  function lockEditor(locked) {
    editor.inert = locked;
    document.getElementById("forecastRoadmap").disabled = locked;
  }
  function flushCloud() {
    if (saving) return saving;
    const currentSession = session;
    const owner = user;
    const operation = (async () => {
      retryButton.hidden = true;
      while (pending && owner && currentSession === session) {
        const snapshot = pending;
        pending = null;
        cloudStatus.textContent = "Zapisywanie prywatnego planu w Firebase…";
        try {
          const nextRevision = await cloud.save(owner.uid, snapshot, revision);
          if (currentSession !== session) return false;
          revision = nextRevision;
        } catch (error) {
          if (currentSession !== session) return false;
          pending ??= snapshot;
          retryButton.hidden = false;
          cloudStatus.textContent = `Nie zapisano w bazie: ${error.message} Zmiany pozostają w tej karcie.`;
          return false;
        }
      }
      if (currentSession === session) {
        cloudStatus.textContent = `Zapisano prywatny plan w Firebase. Konto: ${owner.email || owner.uid}.`;
      }
      return true;
    })().finally(() => {
      if (saving === operation) saving = null;
    });
    saving = operation;
    return operation;
  }
  async function loadAccount(nextUser, authError) {
    const currentSession = ++session;
    user = nextUser;
    cloudReady = false;
    pending = null;
    saving = null;
    persistenceError = "";
    retryButton.hidden = true;
    importButton.hidden = true;
    loginButton.hidden = Boolean(user);
    logoutButton.hidden = !user;
    reloadButton.hidden = !user;
    lockEditor(true);
    // Remove the previous account's content before starting any network request.
    plan = sample();
    ensureCapacity();
    render();
    document.getElementById("roadmapResults").textContent = "Przelicz prognozę po wczytaniu planu.";
    status.textContent = "";
    if (authError) {
      cloudStatus.textContent = `Błąd uwierzytelnienia Firebase: ${authError.message} Odśwież stronę, aby spróbować ponownie.`;
      return;
    }
    if (!user) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const local = JSON.parse(saved);
          if (!isPlan(local)) throw new Error("Niepoprawna struktura lokalnego planu.");
          plan = local;
        }
        ensureCapacity();
        render();
        localReadError = false;
        lockEditor(false);
        cloudStatus.textContent = "Tryb lokalny — zaloguj się, aby zapisywać prywatny plan w Firebase.";
      } catch (error) {
        localReadError = true;
        cloudStatus.textContent = `Nie można wczytać lokalnego planu: ${error.message} Zapis nie został nadpisany.`;
      }
      return;
    }
    cloudStatus.textContent = "Wczytywanie prywatnego planu z Firebase…";
    reloadButton.disabled = true;
    try {
      const saved = await cloud.load(user.uid);
      if (currentSession !== session) return;
      if (saved.plan !== null && !isPlan(saved.plan)) throw new Error("Niepoprawna struktura planu w bazie.");
      revision = saved.revision;
      plan = saved.plan ?? sample();
      ensureCapacity();
      render();
      cloudReady = true;
      lockEditor(false);
      importButton.hidden = false;
      cloudStatus.textContent = saved.plan
        ? `Wczytano prywatny plan z Firebase. Konto: ${user.email || user.uid}. Zmiany zapisują się automatycznie.`
        : "To konto nie ma jeszcze planu. Edytuj przykład lub zaimportuj lokalny plan.";
      if (saved.plan === null) save();
    } catch (error) {
      if (currentSession !== session) return;
      cloudStatus.textContent = `Nie można wczytać planu z Firebase: ${error.message} Edycja zablokowana, aby nie nadpisać danych. Sprawdź logowanie Google, domenę i reguły Firestore.`;
    } finally {
      if (currentSession === session) reloadButton.disabled = false;
    }
  }
  loginButton.addEventListener("click", async () => {
    loginButton.disabled = true;
    try {
      await cloud.login();
    } catch (error) {
      cloudStatus.textContent = `Nie udało się zalogować: ${error.message}`;
    } finally {
      loginButton.disabled = false;
    }
  });
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    lockEditor(true);
    try {
      if ((pending || saving) && !await flushCloud()) return;
      await cloud.logout();
    } catch (error) {
      cloudStatus.textContent = `Nie udało się wylogować: ${error.message}`;
    } finally {
      logoutButton.disabled = false;
      if (cloudReady) lockEditor(false);
    }
  });
  reloadButton.addEventListener("click", async () => {
    if (saving) {
      cloudStatus.textContent = "Trwa zapis — poczekaj na jego zakończenie.";
      return;
    }
    if (pending && !confirm("Wczytać plan z bazy i odrzucić niezapisane zmiany w tej karcie?")) return;
    await loadAccount(user);
  });
  retryButton.addEventListener("click", () => { void flushCloud(); });
  importButton.addEventListener("click", () => {
    if (!cloudReady || !confirm("Zastąpić plan na tym koncie planem zapisanym lokalnie w tej przeglądarce?")) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) throw new Error("Brak lokalnego planu do zaimportowania.");
      const local = JSON.parse(saved);
      if (!isPlan(local)) throw new Error("Niepoprawna struktura lokalnego planu.");
      plan = local;
      changed();
    } catch (error) {
      cloudStatus.textContent = `Import nie powiódł się: ${error.message}`;
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (pending || saving) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  const skillName = (id) => plan.skills.find((skill) => skill.id === id)?.name || "";
  function choices(selected, kind, id) {
    return `<fieldset class="roadmap-choices"><legend>Wymagane kompetencje</legend><div class="row wrap">${
      plan.skills.map((skill) => `<label><input type="checkbox" data-kind="${kind}" data-id="${id}" data-skill="${skill.id}" ${selected.includes(skill.id) ? "checked" : ""}>${escape(skill.name)}</label>`).join("")
    }</div></fieldset>`;
  }
  function render() {
    document.getElementById("roadmapSkills").innerHTML = plan.skills.map((skill) =>
      `<span class="row"><span>${escape(skill.name)}</span><button data-action="remove-skill" data-id="${skill.id}" aria-label="Usuń kompetencję ${escape(skill.name)}">×</button></span>`).join("");
    document.getElementById("roadmapTeams").innerHTML = plan.teams.map((team) =>
      `<div class="roadmap-card"><div class="row wrap"><label>Nazwa zespołu <input data-kind="team-name" data-id="${team.id}" value="${escape(team.name)}" maxlength="80"></label><button data-action="remove-team" data-id="${team.id}">Usuń zespół</button></div>${choices(team.skills, "team-skill", team.id)}</div>`).join("");
    const monthLabels = months.map((month) => new Intl.DateTimeFormat("pl-PL", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(month + "-01T00:00:00Z")));
    document.getElementById("roadmapCapacity").innerHTML = `<table><caption>Capacity zespołów według kompetencji</caption><thead><tr><th>Zespół / kompetencja</th>${monthLabels.map((label) => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>${
      plan.teams.flatMap((team) => team.skills.map((skill) =>
        `<tr><th scope="row">${escape(team.name)} / ${escape(skillName(skill))}</th>${months.map((month, index) =>
          `<td><input type="number" min="0" step="0.5" data-kind="capacity" data-id="${team.id}" data-skill="${skill}" data-month="${month}" value="${team.capacity[skill][month] ?? ""}" aria-label="${escape(team.name)} / ${escape(skillName(skill))} / ${monthLabels[index]}"></td>`).join("")}</tr>`)).join("")
    }</tbody></table>`;
    document.getElementById("roadmapInitiatives").innerHTML = plan.initiatives.map((initiative, index) =>
      `<article class="roadmap-card"><div class="row wrap"><strong>Priorytet ${index + 1}</strong>
        <label>Nazwa inicjatywy <input data-kind="initiative-name" data-id="${initiative.id}" value="${escape(initiative.name)}" maxlength="100"></label>
        <button data-action="up" data-id="${initiative.id}" ${index === 0 ? "disabled" : ""} aria-label="Zwiększ priorytet ${escape(initiative.name)}">↑</button>
        <button data-action="down" data-id="${initiative.id}" ${index === plan.initiatives.length - 1 ? "disabled" : ""} aria-label="Zmniejsz priorytet ${escape(initiative.name)}">↓</button>
        <button data-action="remove-initiative" data-id="${initiative.id}" ${plan.initiatives.length <= 2 ? "disabled" : ""}>Usuń inicjatywę</button></div>
        ${choices(initiative.skills, "initiative-skill", initiative.id)}
        ${initiative.items.map((item, itemIndex) => `<div class="roadmap-element">
          <div class="row wrap"><strong>${itemIndex + 1}.</strong><label>Element <input data-kind="item" data-field="name" data-id="${item.id}" value="${escape(item.name)}" maxlength="100"></label>
          <label>Zespół <select data-kind="item" data-field="team" data-id="${item.id}"><option value="">Wybierz zespół</option>${plan.teams.map((team) => `<option value="${team.id}" ${item.team === team.id ? "selected" : ""}>${escape(team.name)}${initiative.skills.every((skill) => team.skills.includes(skill)) ? "" : " (brak kompetencji)"}</option>`).join("")}</select></label>
          <button data-action="remove-item" data-id="${item.id}">Usuń element</button></div>
          <div class="row wrap"><label>Najwcześniejszy start <input type="date" data-kind="item" data-field="start" data-id="${item.id}" value="${escape(item.start)}"></label>
          <label><input type="checkbox" data-kind="item" data-field="fixed" data-id="${item.id}" ${item.fixed ? "checked" : ""}> Fixed date</label>
          ${item.fixed ? `<label>Termin graniczny <input type="date" data-kind="item" data-field="deadline" data-id="${item.id}" value="${escape(item.deadline)}"></label>` : ""}</div>
          ${initiative.skills.map((skill) => {
            const estimate = item.estimates[skill] || {};
            return `<div class="row wrap"><span>${escape(skillName(skill))} · osobodni</span>${["min", "max"].map((bound) =>
              `<label>${bound} <input type="number" min="0.5" step="0.5" data-kind="estimate" data-id="${item.id}" data-skill="${skill}" data-bound="${bound}" value="${estimate[bound] ?? ""}" aria-label="${escape(initiative.name)} / ${escape(item.name)} / ${escape(skillName(skill))} / ${bound}"></label>`).join("")}</div>`;
          }).join("")}</div>`).join("")}
        <button data-action="add-item" data-id="${initiative.id}">+ Dodaj element</button></article>`).join("");
  }
  function changed(redraw = true) {
    ensureCapacity();
    save();
    if (redraw) render();
    stale();
  }
  function findItem(id) {
    return plan.initiatives.flatMap((initiative) => initiative.items).find((item) => item.id === id);
  }
  panel.addEventListener("change", (event) => {
    const input = event.target;
    const { kind, id, skill, month, field, bound } = input.dataset;
    if (!kind) return;
    const team = plan.teams.find((entry) => entry.id === id);
    const initiative = plan.initiatives.find((entry) => entry.id === id);
    const numeric = () => input.value === "" || !input.validity.valid ? null : Number(input.value);
    let redraw = false;
    if (kind === "team-name") { team.name = input.value; redraw = true; }
    if (kind === "initiative-name") initiative.name = input.value;
    if (kind === "team-skill" || kind === "initiative-skill") {
      const owner = team || initiative;
      owner.skills = input.checked ? [...owner.skills, skill] : owner.skills.filter((value) => value !== skill);
      redraw = true;
    }
    if (kind === "capacity") team.capacity[skill][month] = numeric();
    if (kind === "item") {
      findItem(id)[field] = field === "fixed" ? input.checked : input.value;
      redraw = field === "fixed";
    }
    if (kind === "estimate") {
      const item = findItem(id);
      item.estimates[skill] ??= { min: null, max: null };
      item.estimates[skill][bound] = numeric();
    }
    changed(redraw);
  });
  document.getElementById("addRoadmapSkill").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = event.target.elements.name;
    const name = input.value.trim();
    if (!name || plan.skills.some((skill) => skill.name.toLocaleLowerCase("pl") === name.toLocaleLowerCase("pl"))) {
      status.textContent = "Podaj niepustą, unikalną nazwę kompetencji.";
      return;
    }
    plan.skills.push({ id: uid(), name });
    input.value = "";
    changed();
  });
  panel.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    const { action, id } = button.dataset;
    if (button.id === "addRoadmapTeam") {
      plan.teams.push({ id: uid(), name: "Nowy zespół", skills: [], capacity: {} });
    } else if (button.id === "addRoadmapInitiative") {
      plan.initiatives.push({ id: uid(), name: "Nowa inicjatywa", skills: [], items: [newItem()] });
    } else if (action === "remove-skill") {
      if (!confirm("Usunąć kompetencję oraz jej estymaty i capacity ze wszystkich zespołów i inicjatyw?")) return;
      plan.skills = plan.skills.filter((skill) => skill.id !== id);
      for (const team of plan.teams) {
        team.skills = team.skills.filter((skill) => skill !== id);
        delete team.capacity[id];
      }
      for (const initiative of plan.initiatives) {
        initiative.skills = initiative.skills.filter((skill) => skill !== id);
        for (const item of initiative.items) delete item.estimates[id];
      }
    } else if (action === "remove-team") {
      if (!confirm("Usunąć zespół i jego capacity? Elementy tego zespołu będą wymagać ponownego przypisania.")) return;
      plan.teams = plan.teams.filter((team) => team.id !== id);
      plan.initiatives.forEach((initiative) => initiative.items.forEach((item) => {
        if (item.team === id) item.team = "";
      }));
    } else if (action === "remove-initiative") {
      if (plan.initiatives.length <= 2 || !confirm("Usunąć inicjatywę i wszystkie jej elementy?")) return;
      plan.initiatives = plan.initiatives.filter((initiative) => initiative.id !== id);
    } else if (action === "remove-item") {
      if (!confirm("Usunąć element i jego estymaty?")) return;
      plan.initiatives.forEach((initiative) => { initiative.items = initiative.items.filter((item) => item.id !== id); });
    } else if (action === "add-item") {
      plan.initiatives.find((initiative) => initiative.id === id).items.push(newItem());
    } else if (action === "up" || action === "down") {
      const index = plan.initiatives.findIndex((initiative) => initiative.id === id);
      const target = index + (action === "up" ? -1 : 1);
      if (target < 0 || target >= plan.initiatives.length) return;
      [plan.initiatives[index], plan.initiatives[target]] = [plan.initiatives[target], plan.initiatives[index]];
    } else return;
    changed();
  });
  function renderResults(results) {
    const { start, days } = engine.horizon(months);
    const monthDays = months.map((month) => {
      const current = new Date(month + "-01T00:00:00Z");
      return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate();
    });
    const monthLines = months.map((month) => {
      const offset = (engine.date(month + "-01") - start) / engine.DAY / days * 100;
      return `linear-gradient(to right, transparent ${offset}%, #334155 ${offset}%, #334155 calc(${offset}% + 1px), transparent calc(${offset}% + 1px))`;
    }).join(",");
    const format = (day) => Number.isFinite(day)
      ? new Intl.DateTimeFormat("pl-PL", { timeZone: "UTC" }).format(new Date(start + day * engine.DAY))
      : "Poza horyzontem";
    const percent = (ratio) => new Intl.NumberFormat("pl-PL", { style: "percent", maximumFractionDigits: 1 }).format(ratio);
    const position = (day) => Math.max(0, Math.min(100, day / days * 100));
    const rows = results.map((result) => {
      const { task, start50, end50, end85 } = result;
      const label = `${task.initiative} / ${task.name}`;
      const left = position(start50);
      const medianRight = position(end50 + 1);
      const right = position(end85 + 1);
      const deadlineDay = (engine.date(task.deadline) - start) / engine.DAY;
      return `<div class="roadmap-gantt-row"><div class="roadmap-gantt-label">${escape(label)}</div>
        <div class="roadmap-track" style="background:${monthLines}" role="img" aria-label="${escape(label)}: start P50 ${format(start50)}, koniec P85 ${format(end85)}">
        ${Number.isFinite(start50) ? `<div class="roadmap-bar${Number.isFinite(end85) ? "" : " censored"}" style="left:${left}%;width:${Math.max(0, right - left)}%"></div>${Number.isFinite(end50) ? `<div class="roadmap-bar median" style="left:${left}%;width:${Math.max(0, medianRight - left)}%"></div>` : ""}` : ""}
        ${task.fixed && deadlineDay >= 0 && deadlineDay < days ? `<span class="roadmap-deadline" style="left:${position(deadlineDay)}%" title="Fixed date: ${escape(task.deadline)}"></span>` : ""}</div></div>`;
    }).join("");
    const summaries = plan.initiatives.map((initiative) => {
      const last = results.find((result) => result.task.id === initiative.items.at(-1).id);
      return `<div class="metric"><b>${format(last.end85)}</b><span>${escape(initiative.name)} · koniec P85</span></div>`;
    }).join("");
    document.getElementById("roadmapResults").innerHTML = `<div class="row wrap">${summaries}</div><div class="roadmap-scroll"><div class="roadmap-gantt">
      <div class="roadmap-gantt-row"><span>Inicjatywa / element</span><div class="roadmap-months" style="grid-template-columns:${monthDays.map((count) => `${count}fr`).join(" ")}">${months.map((month) => `<span>${month}</span>`).join("")}</div></div>${rows}</div>
      <table><caption>Wyniki 2000 symulacji Monte Carlo</caption><thead><tr><th>Inicjatywa / element</th><th>Zespół</th><th>Start P50</th><th>Koniec P50</th><th>Koniec P85</th><th>Ukończenie w horyzoncie</th><th>Fixed date</th><th>Szansa dotrzymania terminu</th></tr></thead><tbody>${results.map((result) =>
        `<tr><th scope="row">${escape(result.task.initiative)} / ${escape(result.task.name)}</th><td>${escape(plan.teams.find((team) => team.id === result.task.team).name)}</td><td>${format(result.start50)}</td><td>${format(result.end50)}</td><td>${format(result.end85)}</td><td>${percent(result.completion)}</td><td>${result.task.fixed ? escape(result.task.deadline) : "—"}</td><td class="${result.deadlineChance !== null && result.deadlineChance < 0.85 ? "roadmap-risk" : ""}">${result.deadlineChance === null ? "—" : `${percent(result.deadlineChance)}${engine.date(result.task.deadline) >= engine.horizon(months).end ? " (dolna granica; termin poza horyzontem)" : ""}`}</td></tr>`
      ).join("")}</tbody></table></div>`;
  }
  document.getElementById("forecastRoadmap").addEventListener("click", async (event) => {
    const errors = engine.validate(plan, months);
    if (errors.length) {
      status.textContent = errors.join(" ");
      document.getElementById("roadmapResults").textContent = "Popraw dane przed uruchomieniem prognozy.";
      return;
    }
    const button = event.currentTarget;
    const forecastSession = session;
    button.disabled = true;
    status.textContent = "Trwa 2000 symulacji…";
    // Let the browser paint the busy state before calculating.
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (forecastSession !== session) return;
    try {
      renderResults(engine.simulate(plan, months));
      status.textContent = persistenceError || (user
        ? "Prognoza gotowa. Stan zapisu danych wejściowych w Firebase jest widoczny powyżej."
        : "Prognoza gotowa. Dane wejściowe zapisane lokalnie; wynik jest przeliczany przy każdym uruchomieniu.");
    } catch (error) {
      status.textContent = `Nie udało się obliczyć prognozy: ${error.message}`;
    } finally {
      button.disabled = editor.inert;
    }
  });
  ensureCapacity();
  render();
  save();
  status.textContent = persistenceError || (restored
    ? "Przywrócono plan zapisany w tej przeglądarce. Przelicz prognozę dla aktualnego kalendarza."
    : "Dane są zapisywane lokalnie w tej przeglądarce. Początkowy plan zawiera edytowalne przykłady.");
  lockEditor(true);
  import("./roadmap-cloud.js").then((module) => {
    cloud = module;
    cloud.connect(loadAccount);
    loginButton.disabled = false;
  }).catch((error) => {
    cloudStatus.textContent = `Firebase jest niedostępne: ${error.message} Dostępny jest tylko zapis lokalny. Odśwież stronę, aby ponowić połączenie.`;
    lockEditor(localReadError);
  });
})();
