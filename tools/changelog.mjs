import assert from "node:assert/strict";

const repository = "https://github.com/wondersalmon/probably-just-a-rat";
const categories = {
  en: ["New", "Changes and improvements", "Fixes"],
  ru: ["Новое", "Изменения и улучшения", "Исправления"]
};

/** Validate all historical and pending entries, returning their bilingual shape. */
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
        category++;
        assert.equal(line, `### ${categories[language][category]}`, context);
      } else {
        assert.ok(category >= 0, `${context}: entry before category.`);
        assert.match(line, /^- \*\*[^*\r\n]+:\*\* \S.+$/, context);
        counts[category]++;
      }
    }
    assert.equal(category, 2, `${context}: expected all three categories.`);
    assert.ok(
      version === "Unreleased" || counts.some(Boolean),
      `${context}: empty version.`
    );
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
