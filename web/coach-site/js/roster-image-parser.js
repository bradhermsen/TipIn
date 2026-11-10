export function parseRosterText(text, layout = "jersey-name-position-grade") {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return lines.filter((line) => !/^(?:#|no\.?|number|jersey)\s+(?:name|player|first)\b/i.test(line)
    && !/^(?:first\s+name|player\s+name|name)\s+(?:last\s+name|jersey|#|pos)/i.test(line))
    .map((source) => {
      let tokens = source.replace(/[|;\t]/g, " ").split(/\s+/).filter(Boolean);
      let jerseyNumber = "", grade = "", position = "";
      const number = (value, max) => /^\d{1,2}$/.test(value || "") && Number(value) <= max;
      if (layout.startsWith("jersey") && number(tokens[0]?.replace(/^#/, ""), 99)) {
        jerseyNumber = tokens.shift().replace(/^#/, "");
      }
      if (layout.startsWith("name")) {
        const index = tokens.findIndex((t) => number(t.replace(/^#/, ""), 99));
        if (index >= 0) jerseyNumber = tokens.splice(index, 1)[0].replace(/^#/, "");
      }
      if (number(tokens.at(-1), 12) && tokens.length > 2) grade = tokens.pop();
      const positions = { F: "F", FORWARD: "F", D: "D", DEFENSE: "D", DEFENCE: "D", G: "G", GOALIE: "G", GOALTENDER: "G" };
      if (positions[tokens.at(-1)?.toUpperCase()]) position = positions[tokens.pop().toUpperCase()];
      if (!grade && number(tokens.at(-1), 12) && tokens.length > 2) grade = tokens.pop();
      let firstName = "", lastName = "";
      const name = tokens.join(" ");
      if (name.includes(",")) {
        const parts = name.split(",");
        lastName = parts[0].trim();
        firstName = parts.slice(1).join(" ").trim();
      } else {
        firstName = tokens.shift() || "";
        lastName = tokens.join(" ");
      }
      return { source, firstName, lastName, grade, jerseyNumber, position };
    });
}

export function validateImportRow(row) {
  if (!row.firstName.trim() || !row.lastName.trim()) return "First and last name are required.";
  if (row.firstName.length > 100 || row.lastName.length > 100) return "Names must be 100 characters or fewer.";
  for (const [field, min, max] of [["grade", 1, 12], ["jerseyNumber", 0, 99]]) {
    const value = String(row[field]).trim();
    if (value && (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)) {
      return `${field === "grade" ? "Grade" : "Jersey"} must be ${min}-${max}, or blank.`;
    }
  }
  return null;
}
