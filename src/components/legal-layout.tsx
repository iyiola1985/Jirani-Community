export function LegalLayout({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">{eyebrow}</p>
      <h1 className="mt-3 font-serif text-4xl tracking-tight">{title}</h1>
      <p className="mt-4 text-lg leading-8 text-ink-soft">{lede}</p>
      <div className="mt-8 space-y-4 leading-7 text-ink-soft">{children}</div>
    </article>
  );
}
