'use client'

// Today's absentees (dojos; owner / partner; db/2026-11-19-dojo-activities-absences.md; rules in lib/absences.ts).
// Built when the page opens (normally at the end of the day, from the dojo home). Grouped by home batch; each row
// has Send = a wa.me chat to the parent (or the student) with the gym's absence message. A tick shows which chats
// were opened on this visit (not saved anywhere). "Send to all" walks through the list one chat at a time
// ("Next: Aarav — Send", "3 of 12", Skip) and ends with "Done: 11 opened, 1 skipped". The message template
// (one per gym, kind 'absence') is edited at the bottom with a live preview.
// Before the SQL ran, the page says so (one of the new tables can't be read).

import PageNav from '@/app/page-nav'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso } from '@/lib/locale'
import { canRunClasses, memberWord } from '@/lib/labels'
import { type Batch, type Branch, BATCH_COLUMNS, BRANCH_COLUMNS, timeLabel } from '@/lib/batches'
import { type AttendanceRow, ATTENDANCE_COLUMNS } from '@/lib/attendance'
import { type StudentLeave, LEAVE_COLUMNS } from '@/lib/leave'
import { type Holiday, HOLIDAY_COLUMNS } from '@/lib/holidays'
import { BATCH_CLASS_COLUMNS, saveErrorText } from '@/lib/dojo-activities'
import {
  type AbsenceStudent, type RunState, absenteesFor, absenceMessage, waLink, DEFAULT_ABSENCE_BODY, PLACEHOLDERS, TEMPLATE_MAX,
  templateProblem, unknownPlaceholders, startRun, advance, runDone, runCurrent, runProgress, runSummary,
} from '@/lib/absences'

const STUDENT_COLUMNS = 'id, full_name, phone, branch_id, batch_id, available_days, archived_at, guardian_name, guardian_phone, guardian_relation'

export default function AbsenteesPage() {
  const router = useRouter()
  const today = localDateIso()
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [notDojo, setNotDojo] = useState(false)
  const [me, setMe] = useState<{ id: string; companyId: string } | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [country, setCountry] = useState<Country>('IN')
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [students, setStudents] = useState<AbsenceStudent[]>([])
  const [attendance, setAttendance] = useState<AttendanceRow[]>([])
  const [classes, setClasses] = useState<{ batch_id: string; class_date: string; logged_at: string | null }[]>([])
  const [leaves, setLeaves] = useState<StudentLeave[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [savedBody, setSavedBody] = useState<string | null>(null)   // the gym's template; null = the standard one
  const [branch, setBranch] = useState('all')
  const [opened, setOpened] = useState<Set<string>>(new Set())      // this visit only
  const [run, setRun] = useState<RunState | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [tplError, setTplError] = useState('')
  const [tplSaving, setTplSaving] = useState(false)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }
  const mw = memberWord(businessType)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles').select('company_id, companies:company_id(*)').eq('id', user.id).single()
      if (!profile?.company_id) { router.push('/login'); return }
      const co = (profile as unknown as { companies: { name?: string | null; country?: string | null; business_type?: string | null } | null }).companies
      const cId = profile.company_id as string
      const [br, ba, people, att, cls, lv, hol, tpl] = await Promise.all([
        supabase.from('branches').select(BRANCH_COLUMNS).eq('company_id', cId).order('created_at'),
        supabase.from('batches').select(BATCH_COLUMNS).eq('company_id', cId),
        supabase.from('profiles').select(STUDENT_COLUMNS).eq('company_id', cId).eq('role', 'client').is('archived_at', null),
        supabase.from('attendance').select(ATTENDANCE_COLUMNS).eq('company_id', cId).eq('class_date', today).eq('present', true),
        supabase.from('batch_classes').select(BATCH_CLASS_COLUMNS).eq('company_id', cId).eq('class_date', today),
        supabase.from('student_leaves').select(LEAVE_COLUMNS).eq('company_id', cId).is('cancelled_at', null).lte('from_date', today).gte('to_date', today),
        supabase.from('holidays').select(HOLIDAY_COLUMNS).eq('company_id', cId).eq('holiday_date', today).is('removed_at', null),
        supabase.from('message_templates').select('body').eq('company_id', cId).eq('kind', 'absence').maybeSingle(),
      ])
      if (!live) return
      setMe({ id: user.id, companyId: cId })
      setCompanyName(co?.name || '')
      setCountry(normalizeCountry(co?.country))
      setBusinessType(co?.business_type ?? null)
      if (!canRunClasses(co?.business_type)) setNotDojo(true)
      if ([br, ba, people, att, cls, lv, hol, tpl].some(r => r.error)) {
        ;[br, ba, people, att, cls, lv, hol, tpl].forEach(r => { if (r.error) console.error('Absentees load:', r.error.message) })
        setMissing(true); setLoading(false); return
      }
      setBranches(((br.data || []) as Branch[]).filter(b => !b.is_archived))
      setBatches((ba.data || []) as Batch[])
      setStudents((people.data || []) as AbsenceStudent[])
      setAttendance((att.data || []) as AttendanceRow[])
      setClasses((cls.data || []) as { batch_id: string; class_date: string; logged_at: string | null }[])
      setLeaves((lv.data || []) as StudentLeave[])
      setHolidays((hol.data || []) as Holiday[])
      setSavedBody((tpl.data as { body: string } | null)?.body ?? null)
      setLoading(false)
    })()
    return () => { live = false }
  }, [router, today])

  const shownBatches = useMemo(() => batches.filter(b => branch === 'all' || b.branch_id === branch), [batches, branch])
  const result = useMemo(() => absenteesFor({ date: today, students, batches: shownBatches, attendance, classes, leaves, holidays }),
    [today, students, shownBatches, attendance, classes, leaves, holidays])
  const batchOf = (s: AbsenceStudent) => batches.find(b => b.id === s.batch_id) ?? null
  const messageFor = (s: AbsenceStudent, body: string | null = savedBody) =>
    absenceMessage({ student: s, batch: batchOf(s), date: today, companyName, body, country })
  const everyone = result.groups.flatMap(g => g.students)
  const sendable = everyone.filter(s => messageFor(s).toPhone)
  const byId = (id: string | null) => everyone.find(s => s.id === id) ?? null

  // Opens the chat in a new tab (a tap = a user gesture, so phones allow it) and ticks the row for this visit
  const openChat = (s: AbsenceStudent) => {
    const m = messageFor(s)
    if (!m.toPhone) return false
    window.open(waLink(m.toPhone, m.text), '_blank', 'noopener')
    setOpened(o => new Set(o).add(s.id))
    return true
  }

  const sendAll = () => {
    const ids = sendable.filter(s => !opened.has(s.id)).map(s => s.id)
    if (!ids.length) return
    const r = startRun(ids)
    const first = byId(runCurrent(r))
    if (first) openChat(first)
    setRun(advance(r, 'opened'))
  }
  const runStep = (how: 'opened' | 'skipped') => {
    if (!run) return
    const s = byId(runCurrent(run))
    if (how === 'opened' && s) openChat(s)
    setRun(advance(run, how))
  }

  // ── Template ──────────────────────────────────────────────────────────────────────────────────────────────
  const startEdit = () => { setDraft(savedBody ?? DEFAULT_ABSENCE_BODY); setTplError(''); setEditing(true) }
  const insert = (ph: string) => {
    const el = textRef.current
    const at = el ? el.selectionStart ?? draft.length : draft.length
    const next = draft.slice(0, at) + ph + draft.slice(at)
    setDraft(next)
    requestAnimationFrame(() => { if (el) { el.focus(); el.selectionStart = el.selectionEnd = at + ph.length } })
  }
  const saveTemplate = async () => {
    if (!me || tplSaving) return
    const problem = templateProblem(draft)
    if (problem) { setTplError(problem); return }
    setTplSaving(true)
    const { data, error } = await supabase.from('message_templates')
      .upsert({ company_id: me.companyId, kind: 'absence', body: draft.trim(), updated_by: me.id }, { onConflict: 'company_id,kind' })
      .select('body')
    setTplSaving(false)
    if (error || !data?.length) { setTplError(saveErrorText(error)); return }
    setSavedBody((data[0] as { body: string }).body)
    setEditing(false)
    showToast('Message saved ✓')
  }
  const sample: AbsenceStudent = everyone[0] ?? { id: 'sample', full_name: 'Aarav', guardian_name: 'Priya', guardian_phone: null, phone: null }
  const preview = absenceMessage({ student: sample, batch: everyone[0] ? batchOf(everyone[0]) : batches[0], date: today, companyName, body: editing ? draft : savedBody, country })
  const unknown = editing ? unknownPlaceholders(draft) : []

  const current = run ? byId(runCurrent(run)) : null

  return (
    <div className={`min-h-screen bg-gray-950 text-white ${run ? 'pb-36' : 'pb-10'}`}>
      <PageNav />
      {toast && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6 pointer-events-none">
          <div role="status" className={`min-w-[280px] max-w-sm text-center px-10 py-6 rounded-2xl text-lg font-semibold shadow-2xl ${toast.kind === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>{toast.text}</div>
        </div>
      )}

      <div className="bg-gray-900 border-b border-gray-800 px-4 sm:px-8 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <button data-nav onClick={() => router.push('/company')}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition shrink-0">← Back</button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white">Today&apos;s absentees</h1>
            <p className="text-xs text-gray-500 truncate">{formatDate(today, country, 'weekday')}{companyName ? ` · ${companyName}` : ''}</p>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-5 max-w-2xl mx-auto space-y-4">
        {loading ? (
          <div className="h-40 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
        ) : missing || notDojo ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
            {notDojo ? 'Absentee messages are for dojos.' : "Absentee messages aren't set up yet. CoachBoard will switch them on for your account."}
          </div>
        ) : (
          <div data-testid="page-absentees" className="space-y-4">
            {branches.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Branch">
                {[{ id: 'all', name: 'All branches' }, ...branches].map(b => (
                  <button key={b.id} type="button" aria-pressed={branch === b.id} onClick={() => { setBranch(b.id); setRun(null) }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${branch === b.id ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500'}`}>
                    {b.name}
                  </button>
                ))}
              </div>
            )}

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-2xl font-bold"><span data-testid="absent-count">{result.total}</span> <span className="text-sm font-normal text-gray-400">absent</span></p>
                <p className="text-xs text-gray-500">
                  {[result.onLeave ? `${result.onLeave} on leave` : '', sendable.length < everyone.length ? `${everyone.length - sendable.length} without a WhatsApp number` : '']
                    .filter(Boolean).join(' · ') || 'Holidays, leave and days they don’t attend are left out.'}
                </p>
              </div>
              {sendable.length > 0 && !run && (
                <button type="button" onClick={sendAll} data-testid="send-all"
                  disabled={sendable.every(s => opened.has(s.id))}
                  className="shrink-0 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-40">
                  Send to all ({sendable.filter(s => !opened.has(s.id)).length})
                </button>
              )}
            </div>

            {result.groups.length === 0 && (
              <p className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
                {result.notLogged.length ? 'Nobody absent in the classes taken so far.' : `No absent ${mw.many.toLowerCase()} today.`}
              </p>
            )}

            {result.groups.map(g => (
              <section key={g.batch.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{g.batch.name}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {[timeLabel(g.batch.start_time, country), branches.length > 1 ? branches.find(b => b.id === g.batch.branch_id)?.name : ''].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className="text-xs text-red-300 shrink-0">{g.students.length} absent</span>
                </div>
                <ul className="divide-y divide-gray-800">
                  {g.students.map(s => {
                    const m = messageFor(s)
                    const done = opened.has(s.id)
                    return (
                      <li key={s.id} data-testid="absent-row" data-name={s.full_name} className="flex items-center gap-3 px-4 py-2.5">
                        <span className={`w-5 text-center text-sm ${done ? 'text-green-400' : 'text-gray-700'}`} aria-label={done ? 'Opened' : undefined}>{done ? '✓' : '•'}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-white truncate">{s.full_name}</span>
                          <span className="block text-[11px] text-gray-500 truncate">{m.toPhone ? `to ${m.toLabel}` : 'No WhatsApp number'}</span>
                        </span>
                        {m.toPhone ? (
                          <button type="button" onClick={() => openChat(s)}
                            className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg ${done ? 'border border-gray-700 text-gray-300' : 'bg-green-600 hover:bg-green-500 text-white'}`}>
                            {done ? 'Again' : 'Send'}
                          </button>
                        ) : (
                          <button type="button" data-nav onClick={() => router.push(`/company/client/${s.id}`)}
                            className="shrink-0 text-xs text-gray-400 border border-gray-700 px-3 py-1.5 rounded-lg">Add phone</button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}

            {result.notLogged.length > 0 && (
              <div className="bg-gray-900/60 border border-dashed border-gray-700 rounded-2xl p-4 space-y-2" data-testid="not-logged">
                <p className="text-xs text-gray-400">Roll call not taken yet, so these aren&apos;t on the list:</p>
                <ul className="space-y-1">
                  {result.notLogged.map(n => (
                    <li key={n.batch.id}>
                      <button type="button" data-nav onClick={() => router.push(`/company/attendance/${n.batch.id}`)}
                        className="w-full flex items-center justify-between gap-3 text-sm text-left hover:text-white text-gray-300">
                        <span className="truncate">{n.batch.name}{timeLabel(n.batch.start_time, country) ? ` · ${timeLabel(n.batch.start_time, country)}` : ''}</span>
                        <span className="text-xs text-orange-400 shrink-0">{n.expected} {n.expected === 1 ? mw.one.toLowerCase() : mw.many.toLowerCase()} · Take attendance →</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* The message */}
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3" data-testid="absence-template">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Message</p>
                {!editing && <button type="button" onClick={startEdit} className="text-xs text-orange-400 hover:text-orange-300">Edit message</button>}
              </div>
              {editing && (
                <div className="space-y-2">
                  <textarea ref={textRef} value={draft} onChange={e => setDraft(e.target.value)} rows={4} maxLength={TEMPLATE_MAX} aria-label="Absence message"
                    className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                  <div className="flex flex-wrap gap-1.5">
                    {PLACEHOLDERS.map(ph => (
                      <button key={ph} type="button" onClick={() => insert(ph)}
                        className="text-[11px] text-sky-300 border border-sky-900 bg-sky-950/50 px-2 py-1 rounded">+ {ph}</button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-500">The greeting (&ldquo;Namaste Priya 🙏&rdquo;) is added at the start automatically.</p>
                  {unknown.length > 0 && <p className="text-[11px] text-amber-300">Not a placeholder: {unknown.join(', ')} (it will be sent as typed)</p>}
                  {tplError && <p className="text-xs text-red-400">{tplError}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={saveTemplate} disabled={tplSaving}
                      className="bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">{tplSaving ? 'Saving…' : 'Save message'}</button>
                    <button type="button" onClick={() => setEditing(false)} className="bg-gray-800 hover:bg-gray-700 text-white text-sm px-4 py-2 rounded-lg">Cancel</button>
                    <button type="button" onClick={() => setDraft(DEFAULT_ABSENCE_BODY)} className="text-xs text-gray-400 hover:text-white px-2">Use the standard message</button>
                  </div>
                </div>
              )}
              <div>
                <p className="text-[11px] text-gray-500 mb-1">Preview{everyone[0] ? ` (${everyone[0].full_name})` : ''}</p>
                <p data-testid="absence-preview" className="whitespace-pre-line text-sm text-gray-200 bg-gray-950/60 border border-gray-800 rounded-xl px-3 py-2">{preview.text}</p>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* Send to all: one chat at a time */}
      {run && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-gray-900 border-t border-gray-700 px-4 py-3" data-testid="send-run">
          <div className="max-w-2xl mx-auto">
            {runDone(run) || !current ? (
              <div className="flex items-center gap-3">
                <p className="flex-1 text-sm font-semibold text-green-400">{runSummary(run)}</p>
                <button type="button" onClick={() => setRun(null)} className="bg-gray-800 hover:bg-gray-700 text-white text-sm px-4 py-2 rounded-lg">Close</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-500">{runProgress(run)}</p>
                  <p className="text-sm text-white truncate">Next: <span className="font-semibold">{current.full_name}</span></p>
                </div>
                <button type="button" onClick={() => runStep('skipped')} className="text-sm text-gray-300 border border-gray-700 px-3 py-2 rounded-lg">Skip</button>
                <button type="button" onClick={() => runStep('opened')} className="bg-green-600 hover:bg-green-500 text-white text-sm font-semibold px-4 py-2 rounded-lg">Send</button>
                <button type="button" onClick={() => setRun(null)} aria-label="Stop" className="text-gray-500 hover:text-white px-2">✕</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
