import { TopBar } from "./TopBar";

export function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="shell">
      <TopBar />
      <main className="content">
        {title && <h1>{title}</h1>}
        {children}
      </main>
    </div>
  );
}
