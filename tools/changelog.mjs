import assert from "node:assert/strict";

const repository = "https://github.com/wondersalmon/probably-just-a-rat";
const categories = {
  en: ["New", "Changes and improvements", "Fixes"],
  ru: ["Новое", "Изменения и улучшения", "Исправления"]
};

/** Omit empty categories and versions; keep populated categories in canonical order.
 * Validate all historical and pending entries, returning their bilingual shape.
 */
export function changelogShape(markdown, language) {
  const sections = [...markdown.matchAll(/^## (.+)\r?$/gm)];
  assert.ok(sections.length, "Changelog must contain version sections.");
  const shape = {};
  for (const [index, section] of sections.entries()) {
    const version = section[1].trim();
    const context = `${language} changelog ${version}`;
    assert.match(version, /^(?:Unreleased|\d+\.\d+\.\d+(?:-[\w.-]+)?)$/);
    assert.ok(!(version in shape), `${context}: duplicate version.`);
    const lines = markdown
      .slice(section.index + section[0].length, sections[index + 1]?.index)
      .trim()
      .split(/\r?\n/)
      .filter(line => line.trim());
    const footer = lines.pop();
    const prefix = language === "ru" ? "Документация:" : "Documentation:";
    const readme = language === "ru" ? "README.ru.md" : "README.md";
    const other = language === "ru" ? "CHANGELOG.md" : "CHANGELOG.ru.md";
    const anchor = version.toLowerCase().replaceAll(".", "");
    assert.ok(footer?.startsWith(`${prefix} `), `${context}: missing footer.`);
    const links = [...footer.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
    assert.deepEqual(
      links.map(link => link[2]),
      [
        `${repository}/blob/main/${readme}`,
        `${repository}/blob/HEAD/${other}#${anchor}`
      ],
      `${context}: expected main-branch documentation and other-language links.`
    );
    assert.equal(
      footer,
      `${prefix} ${links[0][0]} · ${links[1][0]}.`,
      `${context}: invalid footer format.`
    );
    let category = -1;
    const counts = [0, 0, 0];
    for (const line of lines) {
      if (line.startsWith("### ")) {
        if (category >= 0)
          assert.ok(counts[category], `${context}: omit empty categories.`);
        const next = categories[language].indexOf(line.slice(4));
        assert.ok(next > category, `${context}: invalid category or order.`);
        category = next;
      } else {
        assert.ok(category >= 0, `${context}: entry before category.`);
        assert.match(line, /^- \*\*[^*\r\n]+:\*\* \S.+$/, context);
        counts[category]++;
      }
    }
    assert.ok(category >= 0, `${context}: omit empty versions.`);
    assert.ok(counts[category], `${context}: omit empty categories.`);
    shape[version] = counts;
  }
  return shape;
}

export function validateChangelogs(english, russian) {
  const en = changelogShape(english, "en");
  const ru = changelogShape(russian, "ru");
  assert.deepEqual(
    Object.keys(en),
    Object.keys(ru),
    "Changelog version order differs."
  );
  assert.deepEqual(en, ru, "Changelog category bullet counts differ.");
}
