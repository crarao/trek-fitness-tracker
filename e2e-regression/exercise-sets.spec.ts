// Weight and reps per set (17 Nov, FitLoft) for an E2E PT member of QA Gym (QA PT is only read).
// A plan for this week with today as a workout day (one exercise, 3 sets) is added straight through Supabase
// as the owner. On the client page the owner ticks the exercise, fills 3 different sets, checks + Set / ✕,
// the Save bar summary and Save. The saved exercise_logs row must hold the 3 sets in set_details and the
// summary columns (sets = 3, reps / weight = the heaviest set); the Sessions tab lists the sets.
// Nothing is deleted: the member is archived at the end.
import { test, expect, rest, e2eName, myCompanyId, createMember, archiveMember } from './fixtures'
import { todayIST, weekdayIST } from './helpers'

// Monday of the week of an ISO date (plain UTC date arithmetic on the string)
const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

test('R30 per-set weights: set rows, + Set / ✕, Save bar, saved as set_details', async ({ as }) => {
  const name = e2eName('sets')
  const exercise = `E2E Squat ${name.split(' ')[1]}` // not in the library: saved with exercise_id null
  const owner = await as('gymOwner')
  await owner.goto('/company')
  const companyId = await myCompanyId('gymOwner')
  const id = await createMember(owner, companyId, name, { client_type: 'pt' })
  try {
    const today = todayIST()
    const day = weekdayIST()
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
      d === day
        ? { day: d, rest: false, focus: 'Legs', exercises: [{ name: exercise, sets: '3', reps: '10', rest: '', note: '' }] }
        : { day: d, rest: true, focus: '', exercises: [] }
    ))
    const ownerRest = rest('gymOwner')
    const plan = await ownerRest.post('weekly_plans', {
      client_id: id, week_start: mondayOf(today), plan_details: `${day}: ${exercise} 3x10`, workout_time: '',
      plan_json: { version: 1, days, note: '' },
    })
    expect(plan.status, 'adding this week\'s plan').toBe(201)

    await owner.goto(`/company/client/${id}?tab=plans`)
    await expect(owner.getByTestId('page-client')).toContainText(name)
    await owner.getByRole('tab', { name: 'Plans', exact: true }).click()

    // Tick the exercise: 3 set rows (the plan's sets) and the sticky Save bar
    await owner.getByRole('checkbox', { name: new RegExp(exercise) }).click()
    const kg = (n: number) => owner.getByLabel(`${exercise} set ${n} kg`)
    const reps = (n: number) => owner.getByLabel(`${exercise} set ${n} reps`)
    await expect(kg(3)).toBeVisible()
    await expect(kg(4)).toHaveCount(0)
    const bar = owner.getByTestId('save-session-bar')
    await expect(bar).toBeVisible()

    for (const [n, w, r] of [[1, '5', '3'], [2, '7', '4'], [3, '9', '4']] as const) {
      await kg(n).fill(w)
      await reps(n).fill(r)
    }
    await expect(bar).toContainText('1 exercise · 3 sets')

    // + Set copies the row above; ✕ removes it again; the last row can't be removed
    await owner.getByRole('button', { name: '+ Set' }).click()
    await expect(kg(4)).toHaveValue('9')
    await expect(reps(4)).toHaveValue('4')
    await expect(bar).toContainText('1 exercise · 4 sets')
    await owner.getByRole('button', { name: `Remove set 4 of ${exercise}` }).click()
    await expect(kg(4)).toHaveCount(0)
    await expect(bar).toContainText('1 exercise · 3 sets')

    await bar.getByRole('button', { name: 'Save session' }).click()
    await expect(owner.getByText(/✓ Session saved · 1 of 1 exercise/)).toBeVisible()

    // Saved: one row, sets in set_details, summary = count + heaviest set
    await expect.poll(async () => (await ownerRest.get(`exercise_logs?select=sets,reps,weight,set_details,exercise_name&client_id=eq.${id}`)).rows, {
      message: 'the saved exercise_logs row',
    }).toEqual([{
      sets: 3, reps: 4, weight: 9, exercise_name: exercise,
      set_details: [{ kg: 5, reps: 3 }, { kg: 7, reps: 4 }, { kg: 9, reps: 4 }],
    }])

    // The Sessions tab lists each set
    await owner.getByRole('tab', { name: 'Sessions', exact: true }).click()
    await expect(owner.getByText(`${exercise} 5 kg × 3 · 7 kg × 4 · 9 kg × 4`)).toBeVisible()
  } finally {
    await archiveMember('gymOwner', id)
  }
})
