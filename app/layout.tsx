import type { Metadata } from "next";
import "./style.css";

export const metadata: Metadata = {
  title: "QA Study Planner",
  description: "Plan QA training, practice topics, and keep track of scheduled reviews.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
