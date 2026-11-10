export const ROSTER_COLUMNS = [
  ["jerseyNumber", "Jersey #"], ["name", "Name"], ["position", "Position"], ["grade", "Grade"],
];

export function setRosterColumn(columns, index, value) {
  if (!ROSTER_COLUMNS.some(([field]) => field === value) || index < 0 || index > 3) {
    throw new Error("Invalid roster column selection.");
  }
  const next = columns.slice(0, index).concat(value);
  if (new Set(next).size !== next.length) throw new Error("Each roster field can only be selected once.");
  for (let i = index + 1; i < 4; i++) {
    next.push(!next.includes(columns[i]) ? columns[i] : ROSTER_COLUMNS.find(([field]) => !next.includes(field))[0]);
  }
  return next;
}

export function parseRosterText(text, columns = ROSTER_COLUMNS.map(([field]) => field)) {
  if (columns.length !== 4 || new Set(columns).size !== 4 || columns.some((c) => !ROSTER_COLUMNS.some(([field]) => field === c))) {
    throw new Error("Select Name, Jersey #, Position, and Grade exactly once.");
  }
  const positions = { F: "F", FORWARD: "F", D: "D", DEFENSE: "D", DEFENCE: "D", G: "G", GOALIE: "G", GOALTENDER: "G" };
  const number = (value, max) => /^\d{1,2}$/.test(value || "") && Number(value) <= max;
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return lines.filter((line) => !/^(?:#|no\.?|number|jersey)\s+(?:name|player|first)\b/i.test(line)
    && !/^(?:first\s+name|player\s+name|name)\s+(?:last\s+name|jersey|#|pos)/i.test(line)
    && !/^(?:(?:jersey\s*#?|name|position|pos\.?|grade|#)\s*[|;\t ]*)+$/i.test(line))
    .map((source) => {
      const fields = { name: "", jerseyNumber: "", position: "", grade: "" };
      const cells = source.split(/[|;\t]/).map((cell) => cell.trim());
      if (cells.length === 4) {
        columns.forEach((field, i) => { fields[field] = cells[i]; });
      } else {
        const tokens = source.replace(/[|;\t]/g, " ").split(/\s+/).filter(Boolean);
        const take = (field, fromEnd) => {
          const value = (fromEnd ? tokens.at(-1) : tokens[0]) || "";
          const valid = field === "position" ? positions[value.toUpperCase()]
            : number(field === "jerseyNumber" ? value.replace(/^#/, "") : value, field === "grade" ? 12 : 99);
          if (valid) fields[field] = fromEnd ? tokens.pop() : tokens.shift();
        };
        const nameIndex = columns.indexOf("name");
        columns.slice(0, nameIndex).forEach((field) => take(field, false));
        columns.slice(nameIndex + 1).reverse().forEach((field) => take(field, true));
        fields.name = tokens.join(" ");
      }
      let firstName = "", lastName = "";
      const name = fields.name;
      if (name.includes(",")) {
        const parts = name.split(",");
        lastName = parts[0].trim();
        firstName = parts.slice(1).join(" ").trim();
      } else {
        const names = name.split(/\s+/);
        firstName = names.shift() || "";
        lastName = names.join(" ");
      }
      return { source, firstName, lastName, grade: fields.grade, jerseyNumber: fields.jerseyNumber.replace(/^#/, ""),
        position: positions[fields.position.toUpperCase()] || fields.position };
    });
}

export function validateImportRow(row) {
  if (!row.firstName.trim() || !row.lastName.trim()) return "First and last name are required.";
  if (row.firstName.length > 100 || row.lastName.length > 100) return "Names must be 100 characters or fewer.";
  if (row.position && !["F", "D", "G"].includes(row.position)) return "Choose Forward, Defense, Goalie, or leave position blank.";
  for (const [field, min, max] of [["grade", 1, 12], ["jerseyNumber", 0, 99]]) {
    const value = String(row[field]).trim();
    if (value && (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)) {
      return `${field === "grade" ? "Grade" : "Jersey"} must be ${min}-${max}, or blank.`;
    }
  }
  return null;
}
