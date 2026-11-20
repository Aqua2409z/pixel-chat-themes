import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'pixel-themes'
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
type Surface = (typeof SURFACES)[number]

const pane = (requestId: string, surface: Surface) =>
  ({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId,
    props: { title: 'Pixel', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  }) as const

const band = (surface: Surface) =>
  ({
    plugin: PLUGIN,
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  }) as const

const userMessage = (surface: Surface) =>
  ({
    plugin: PLUGIN,
    surface,
    component: 'UserMessage',
    requestId: 'm1',
    props: { text: 'hi', origin: { kind: 'composer' }, isExpanded: false },
  }) as const

// The engine beneath the plugin: a store in memory, and a session that
// registers, opens and draws a plain row. Returns the store to read back.
function engine(on: On, kept?: unknown) {
  const store = new Map<string, unknown>(kept === undefined ? [] : [['prefs', kept]])
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'pixel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return store
}

const pixel = (args: string) =>
  ({ command: 'pixel', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const

test('/pixel hoian switches the theme, keeps it, and draws the Hội An strip where SVG exists', async ($, on) => {
  const store = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ran = await $.command.run(pixel('hoian'))
  expect(ran.text).toContain('Hội An')
  expect(store.get('prefs')).toEqual({ theme: 'hoian', band: true, tint: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    const svg = await ui.find({ type: 'Svg' })
    if (surface === 'terminal') expect(svg).toBeUndefined()
    else expect(String(svg?.props.alt)).toContain('Hội An')
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await ui.unmount()
  }
})

test('a theme kept from an earlier session comes back, and Vietnamese names work', async ($, on) => {
  const store = engine(on, { theme: 'galaxy', band: false, tint: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const off = await $.ui.mount(band('desktop'))
  expect(await off.find({ type: 'Svg' })).toBeUndefined()
  await off.unmount()

  await $.command.run(pixel('fuji'))
  expect(store.get('prefs')).toEqual({ theme: 'sakura', band: false, tint: true })

  const unknown = await $.command.run(pixel('pizza'))
  expect(unknown.text).toContain('Không có theme')

  // The eight early themes were removed; their names no longer pick anything.
  for (const gone of ['koi', 'cloud', 'moon', 'jelly']) {
    expect((await $.command.run(pixel(gone))).text).toContain('Không có theme')
  }

  // Each theme answers to its Vietnamese names.
  for (const [typed, id] of [['vietnam', 'vn'], ['Việt Nam', 'vn'], ['co', 'vn'], ['sakura', 'sakura'], ['anh đào', 'sakura'], ['galaxy', 'galaxy'], ['vu tru', 'galaxy'], ['ngân hà', 'galaxy'], ['Hội An', 'hoian'], ['den long', 'hoian'], ['hoa', 'sakura'], ['tet', 'tet'], ['tết', 'tet'], ['banh chung', 'tet']] as const) {
    await $.command.run(pixel(typed))
    expect((store.get('prefs') as { theme: string }).theme).toBe(id)
  }
})

test('the picker applies a theme on press, on every surface', async ($, on) => {
  const store = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const [surface, id] of [['terminal', 'sakura'], ['desktop', 'galaxy'], ['vscode', 'hoian'], ['mobile', 'vn']] as const) {
    const ui = await $.ui.mount(pane('pixel-picker', surface))
    await ui.press({ key: id })
    expect(((store.get('prefs')) as { theme: string }).theme).toBe(id)
    expect((await ui.find({ key: id }))?.text).toContain('✓')
    await ui.unmount()
  }

  const ui = await $.ui.mount(pane('pixel-picker', 'desktop'))
  await ui.press({ key: 'off' })
  expect(((store.get('prefs')) as { theme: string }).theme).toBe('off')
  await ui.unmount()
})

test('messages get a themed frame until tint is turned off', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(userMessage(surface))
    const box = await ui.find({ type: 'Box' })
    expect(box?.props.borderStyle).toBe('round')
    expect(box?.props.borderColor).toBe('#da251d')
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await ui.unmount()
  }

  await $.command.run(pixel('tint'))
  const plain = await $.ui.mount(userMessage('desktop'))
  expect(await plain.find({ type: 'Box' })).toBeUndefined()
  await plain.unmount()
})

test('a theme removed since an earlier session falls back to Việt Nam', async ($, on) => {
  engine(on, { theme: 'koi', band: true, tint: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(band('desktop'))
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('Việt Nam')
  await ui.unmount()
})

test('the side pane shows the tall scene, or says the wallpaper is off', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const side = await $.ui.mount(pane('pixel-scene', 'desktop'))
  expect(String((await side.find({ type: 'Svg' }))?.props.alt)).toContain('Việt Nam')
  await side.unmount()

  await $.command.run(pixel('off'))
  const off = await $.ui.mount(pane('pixel-scene', 'desktop'))
  expect((await off.find({ type: 'Text', text: /tắt/ }))?.text).toContain('/pixel')
  await off.unmount()
})
