/**
 * Document style selector for the Generate page. Each card is a tiny CSS mock-up of the
 * resume layout so the user can tell the styles apart at a glance.
 */
export const DOCUMENT_STYLES = [
  { id: 'classic', name: 'Classic', description: 'Black & white, centered header. ATS-safe.', isDefault: true,
    preview: { align: 'center', accent: '#111827', band: null, rule: false, serif: false, muted: '#9ca3af' } },
  { id: 'modern', name: 'Modern', description: 'Navy accents with rules under each section.',
    preview: { align: 'left', accent: '#1f3a5f', band: null, rule: true, serif: false, muted: '#9ca3af' } },
  { id: 'minimal', name: 'Minimal', description: 'Airy, understated headings, soft greys.',
    preview: { align: 'left', accent: '#374151', band: null, rule: false, serif: false, muted: '#d1d5db', small: true } },
  { id: 'executive', name: 'Executive', description: 'Traditional serif with a double rule.',
    preview: { align: 'center', accent: '#2b2b2b', band: null, rule: true, serif: true, muted: '#9ca3af', doubleRule: true } },
  { id: 'bold', name: 'Bold', description: 'Dark header band, teal section titles.',
    preview: { align: 'left', accent: '#0f766e', band: '#0f172a', rule: true, serif: false, muted: '#9ca3af' } },
  { id: 'compact', name: 'Compact', description: 'Smaller type, tighter spacing, fits more.',
    preview: { align: 'left', accent: '#1f2937', band: null, rule: true, serif: false, muted: '#9ca3af', dense: true } }
];

function MiniPreview({ p }) {
  const lineColor = '#d1d5db';
  const rows = p.dense ? 7 : 5;
  const Heading = () => (
    <div className="mt-1.5">
      <div style={{ height: p.small ? 3 : 4, width: '38%', background: p.accent, borderRadius: 1 }} />
      {p.rule && <div style={{ height: 1, background: p.accent, opacity: 0.6, marginTop: 2 }} />}
    </div>
  );
  return (
    <div
      className="relative w-full overflow-hidden rounded border border-gray-200 bg-white dark:border-gray-700"
      style={{ aspectRatio: '8.5 / 11', fontFamily: p.serif ? 'Georgia, serif' : 'inherit' }}
      aria-hidden="true"
    >
      {/* header */}
      <div style={{ background: p.band || 'transparent', padding: '8px 8px 6px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: p.align === 'center' ? 'center' : 'flex-start', gap: 3 }}>
          <div style={{ height: 6, width: '45%', background: p.band ? '#ffffff' : p.accent, borderRadius: 1 }} />
          <div style={{ height: 2.5, width: '60%', background: p.band ? 'rgba(255,255,255,0.8)' : p.muted, borderRadius: 1 }} />
        </div>
        {p.doubleRule && (
          <div style={{ marginTop: 5 }}>
            <div style={{ height: 1, background: p.accent }} />
            <div style={{ height: 1, background: p.accent, marginTop: 1.5 }} />
          </div>
        )}
      </div>
      {/* body */}
      <div style={{ padding: '0 8px 8px' }}>
        {[0, 1, 2].map((s) => (
          <div key={s}>
            <Heading />
            {Array.from({ length: s === 1 ? rows : 2 }).map((_, i) => (
              <div key={i} style={{ height: p.dense ? 1.5 : 2, width: `${92 - (i % 3) * 14}%`, background: lineColor, borderRadius: 1, marginTop: p.dense ? 2 : 3 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StylePicker({ value, onChange, disabled }) {
  return (
    <div className="space-y-2" data-style-picker>
      <div className="flex items-baseline justify-between">
        <label className="label">Document style</label>
        <span className="text-xs text-gray-400">Applies to the resume and cover letter</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {DOCUMENT_STYLES.map((style) => {
          const selected = value === style.id;
          return (
            <button
              key={style.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(style.id)}
              className={`text-left rounded-lg border p-1.5 transition-colors disabled:opacity-60 ${
                selected
                  ? 'border-primary-500 ring-2 ring-primary-200 bg-primary-50/40 dark:bg-primary-900/20 dark:ring-primary-800'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
              }`}
              title={style.description}
              aria-pressed={selected}
              data-style-option={style.id}
            >
              <MiniPreview p={style.preview} />
              <div className="mt-1.5 px-0.5">
                <p className={`text-xs font-semibold ${selected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-800 dark:text-gray-200'}`}>
                  {style.name}
                  {style.isDefault && <span className="ml-1 text-[10px] font-normal text-gray-400">default</span>}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">{DOCUMENT_STYLES.find((s) => s.id === value)?.description}</p>
    </div>
  );
}
