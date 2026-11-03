(function (root) {
  "use strict";
  const DAY = 86400000;
  const iso = (date) => date.toISOString().slice(0, 10);
  const date = (value) => Date.parse(value + "T00:00:00Z");
  function monthsFrom(today = new Date()) {
    return Array.from({ length: 12 }, (_, i) =>
      iso(new Date(Date.UTC(today.getFullYear(), today.getMonth() + i, 1))).slice(0, 7));
  }
  function horizon(months) {
    const start = date(months[0] + "-01");
    const last = new Date(date(months[11] + "-01"));
    const end = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1);
    return { start, end, days: Math.round((end - start) / DAY) };
  }
  function validate(plan, months) {
    const errors = [];
    const { start, end } = horizon(months);
    const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(date(value)) && iso(new Date(date(value))) === value;
    if (plan.skills.length === 0) errors.push("Dodaj co najmniej jedną kompetencję.");
    if (plan.teams.length === 0) errors.push("Dodaj co najmniej jeden zespół.");
    if (plan.initiatives.length < 2) errors.push("Dodaj co najmniej dwie inicjatywy.");
    for (const team of plan.teams) {
      if (!team.name.trim()) errors.push("Uzupełnij nazwę zespołu.");
      for (const skill of team.skills) {
        for (const month of months) {
          const value = team.capacity[skill]?.[month];
          if (!Number.isFinite(value) || value < 0) errors.push(`${team.name}: uzupełnij nieujemne capacity na ${month}.`);
        }
      }
    }
    for (const initiative of plan.initiatives) {
      const name = initiative.name || "Inicjatywa bez nazwy";
      if (!initiative.name.trim()) errors.push("Uzupełnij nazwę inicjatywy.");
      if (!initiative.skills.length) errors.push(`${name}: zaznacz kompetencje.`);
      if (!initiative.items.length) errors.push(`${name}: dodaj element.`);
      for (const item of initiative.items) {
        const label = `${name} / ${item.name || "element bez nazwy"}`;
        if (!item.name.trim()) errors.push(`${label}: uzupełnij nazwę.`);
        if (!validDate(item.start) || date(item.start) < start || date(item.start) >= end) errors.push(`${label}: data startu musi mieścić się w kalendarzu capacity.`);
        if (item.fixed && (!validDate(item.deadline) || date(item.deadline) < date(item.start))) errors.push(`${label}: fixed date musi być poprawną datą nie wcześniejszą niż start.`);
        const team = plan.teams.find((entry) => entry.id === item.team);
        if (!team || !initiative.skills.every((skill) => team.skills.includes(skill))) errors.push(`${label}: wybierz zespół ze wszystkimi wymaganymi kompetencjami.`);
        for (const skill of initiative.skills) {
          const estimate = item.estimates[skill];
          if (!estimate || !Number.isFinite(estimate.min) || !Number.isFinite(estimate.max) || estimate.min <= 0 || estimate.max < estimate.min) errors.push(`${label}: estymaty muszą spełniać 0 < min ≤ max.`);
        }
      }
    }
    return [...new Set(errors)];
  }
  function quantile(values, p) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length * p) - 1];
  }
  function simulate(plan, months, iterations = 2000, random = Math.random) {
    const errors = validate(plan, months);
    if (errors.length) throw new Error(errors.join("\n"));
    if (!Number.isInteger(iterations) || iterations < 1) throw new Error("Niepoprawna liczba symulacji.");
    const { start, days } = horizon(months);
    const calendar = Array.from({ length: days }, (_, day) => {
      const current = new Date(start + day * DAY);
      return {
        month: iso(current).slice(0, 7),
        days: new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate()
      };
    });
    const tasks = plan.initiatives.flatMap((initiative) => initiative.items.map((item, index) => ({
      ...item, initiative: initiative.name, skills: initiative.skills,
      previous: index ? initiative.items[index - 1].id : null
    })));
    const results = tasks.map((task) => ({ task, starts: [], ends: [], hits: 0 }));
    for (let run = 0; run < iterations; run++) {
      const work = tasks.map((task) => ({
        remaining: task.skills.map((skill) => {
          const { min, max } = task.estimates[skill];
          return min + random() * (max - min);
        }),
        start: Infinity, end: Infinity,
        earliest: Math.round((date(task.start) - start) / DAY)
      }));
      const byId = new Map(tasks.map((task, index) => [task.id, work[index]]));
      for (let day = 0; day < days; day++) {
        const pools = new Map();
        for (const team of plan.teams) {
          for (const skill of team.skills) pools.set(`${team.id}/${skill}`, team.capacity[skill][calendar[day].month] / calendar[day].days);
        }
        tasks.forEach((task, index) => {
          const current = work[index];
          if (current.end !== Infinity || day < current.earliest || (task.previous && byId.get(task.previous).end >= day)) return;
          task.skills.forEach((skill, skillIndex) => {
            const key = `${task.team}/${skill}`;
            const available = pools.get(key) || 0;
            const used = Math.min(available, current.remaining[skillIndex]);
            if (used > 0) current.start = Math.min(current.start, day);
            current.remaining[skillIndex] = Math.max(0, current.remaining[skillIndex] - used);
            pools.set(key, available - used);
          });
          if (current.remaining.every((value) => value < 1e-9)) current.end = day;
        });
      }
      work.forEach((current, index) => {
        const result = results[index];
        result.starts.push(current.start);
        result.ends.push(current.end);
        if (result.task.fixed && current.end !== Infinity && start + current.end * DAY <= date(result.task.deadline)) result.hits++;
      });
    }
    return results.map(({ task, starts, ends, hits }) => ({
      task,
      start50: quantile(starts, 0.5),
      end50: quantile(ends, 0.5),
      end85: quantile(ends, 0.85),
      completion: ends.filter(Number.isFinite).length / iterations,
      deadlineChance: task.fixed ? hits / iterations : null
    }));
  }
  const api = { DAY, iso, date, monthsFrom, horizon, validate, simulate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RoadmapEngine = api;
})(globalThis);
