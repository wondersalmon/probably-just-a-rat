/** Extract one exact version. Release notes never include unrelated sections. */
export function releaseNotes(markdown, version) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))
    throw new Error("Invalid release version.");
  const sections = [
    ...markdown.matchAll(
      /^## (?:\[([^\]]+)\]|(\d+\.\d+\.\d+(?:-[\w.-]+)?))[^\r\n]*$/gm
    )
  ];
  const matches = sections.filter(
    section => (section[1] ?? section[2]) === version
  );
  if (matches.length !== 1)
    throw new Error(`Expected one changelog section for ${version}.`);
  const section = matches[0];
  const next = sections[sections.indexOf(section) + 1];
  const body = markdown
    .slice(section.index + section[0].length, next?.index ?? markdown.length)
    .trim();
  if (!body) throw new Error("Release notes must not be empty.");
  return `${section[0]}\n\n${body}\n`;
}
