import { sections } from "../../../lib/sections";

export const dynamicParams = false;

export function generateStaticParams() {
  return sections.map(({ slug }) => ({ section: slug }));
}

export default function SectionPage() {
  return null;
}
