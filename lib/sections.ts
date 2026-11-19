export const sections = [
  { slug: "today", title: "Today", icon: "⌂" },
  { slug: "calendar", title: "Calendar", icon: "▦" },
  { slug: "topics", title: "Topics", icon: "▤" },
  { slug: "tests", title: "Tests", icon: "☷" },
  { slug: "review", title: "Review", icon: "↻" },
  { slug: "dashboard", title: "Dashboard", icon: "◫" },
] as const;

export type Section = typeof sections[number]["title"];
