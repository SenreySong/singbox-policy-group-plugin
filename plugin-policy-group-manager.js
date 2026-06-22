const DATA_DIR = 'data/third/policy-group-manager'
const CONFIG_FILE = DATA_DIR + '/settings.json'
const DEFAULT_SETTINGS = {
  enabled: true,
  insertPosition: 'before',
  skipHiddenSelectors: true,
  taiwanPattern: 'CN2|CFT'
}
const COUNTRY_GROUPS = [
  { tag: '🇭🇰 HK Group', code: 'HK', name: '香港', regex: /(?:🇭🇰|(?:^|[^A-Z])HK\d*|Hong\s*Kong|HongKong|香港)/i },
  { tag: '🇹🇼 TW Group', code: 'TW', name: '台湾', regex: /(?:🇹🇼|(?:^|[^A-Z])TW\d*|Taiwan|台湾|台灣)/i, extraPatternKey: 'taiwanPattern' },
  { tag: '🇯🇵 JP Group', code: 'JP', name: '日本', regex: /(?:🇯🇵|(?:^|[^A-Z])JP\d*|Japan|日本)/i },
  { tag: '🇺🇸 US Group', code: 'US', name: '美国', regex: /(?:🇺🇸|(?:^|[^A-Z])US\d*|United\s*States|America|美国|美國)/i },
  { tag: '🇦🇺 AU Group', code: 'AU', name: '澳大利亚', regex: /(?:🇦🇺|(?:^|[^A-Z])AU\d*|Australia|澳大利亚|澳洲)/i },
  { tag: '🇩🇪 DE Group', code: 'DE', name: '德国', regex: /(?:🇩🇪|(?:^|[^A-Z])DE\d*|Germany|德国|德國)/i }
]
const EXCLUDED_TYPES = new Set(['selector', 'urltest', 'direct', 'block', 'dns'])

window[Plugin.id] = window[Plugin.id] || {
  settings: Vue.ref({ ...DEFAULT_SETTINGS }),
  loaded: false
}

const getState = () => window[Plugin.id]

const ensureDataFile = async () => {
  if (!(await Plugins.FileExists('data/third').catch(() => false))) {
    await Plugins.MakeDir('data/third')
  }
  if (!(await Plugins.FileExists(DATA_DIR).catch(() => false))) {
    await Plugins.MakeDir(DATA_DIR)
  }
  if (!(await Plugins.FileExists(CONFIG_FILE).catch(() => false))) {
    await Plugins.WriteFile(CONFIG_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2))
  }
}

const normalizeSettings = (settings) => {
  const insertPosition = settings?.insertPosition === 'after' ? 'after' : 'before'
  return {
    enabled: settings?.enabled !== false,
    insertPosition,
    skipHiddenSelectors: settings?.skipHiddenSelectors !== false,
    taiwanPattern: String(settings?.taiwanPattern || DEFAULT_SETTINGS.taiwanPattern).trim()
  }
}

const readSettings = async () => {
  await ensureDataFile()
  const content = await Plugins.ReadFile(CONFIG_FILE).catch(() => '{}')
  try {
    return normalizeSettings(JSON.parse(content))
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS)
  }
}

const saveSettings = async (settings) => {
  await ensureDataFile()
  await Plugins.WriteFile(CONFIG_FILE, JSON.stringify(normalizeSettings(settings), null, 2))
}

const loadSettings = async () => {
  if (!getState().loaded) {
    getState().settings.value = await readSettings()
    getState().loaded = true
  }
  return getState().settings.value
}

const onReady = async () => {
  await loadSettings()
}

const onRun = async () => {
  await openManager()
}

const onBeforeCoreStart = async (config, profile) => {
  const settings = await loadSettings()
  if (!settings.enabled) return config
  if (!Array.isArray(config?.outbounds)) return config

  applyPolicyGroups(config, profile, settings)
  return config
}

const applyPolicyGroups = (config, profile, settings) => {
  const generatedGroupTags = new Set(COUNTRY_GROUPS.map((group) => group.tag))
  const nodes = config.outbounds.filter(isRealNode)
  const countrySelectors = []

  for (const group of COUNTRY_GROUPS) {
    const matchedNodes = nodes
      .filter((node) => matchCountryGroup(node.tag, group, settings))
      .map((node) => node.tag)

    if (matchedNodes.length === 0) continue
    countrySelectors.push({
      type: 'selector',
      tag: group.tag,
      outbounds: unique(matchedNodes),
      interrupt_exist_connections: false
    })
  }

  const availableGroupTags = countrySelectors.map((group) => group.tag)
  config.outbounds = config.outbounds.filter((outbound) => !generatedGroupTags.has(outbound.tag))
  config.outbounds.unshift(...countrySelectors)

  const hiddenSelectorTags = getHiddenSelectorTags(profile)
  for (const selector of config.outbounds.filter((outbound) => shouldPatchSelector(outbound, generatedGroupTags, hiddenSelectorTags, settings))) {
    const retainedOutbounds = (selector.outbounds || []).filter((tag) => !generatedGroupTags.has(tag))
    selector.outbounds = settings.insertPosition === 'after'
      ? unique([...retainedOutbounds, ...availableGroupTags])
      : unique([...availableGroupTags, ...retainedOutbounds])
  }

  cleanupMissingSelectorReferences(config)
}

const matchCountryGroup = (tag, group, settings) => {
  if (!group.regex.test(tag)) return false
  if (!group.extraPatternKey) return true
  const pattern = String(settings[group.extraPatternKey] || '').trim()
  if (!pattern) return true
  return safeRegexTest(pattern, tag)
}

const isRealNode = (outbound) => {
  return outbound?.tag && !EXCLUDED_TYPES.has(outbound.type)
}

const unique = (items) => Array.from(new Set(items.filter(Boolean)))

const safeRegexTest = (pattern, value) => {
  try {
    return new RegExp(pattern, 'i').test(value)
  } catch {
    return false
  }
}

const getHiddenSelectorTags = (profile) => {
  const profileOutbounds = Array.isArray(profile?.outbounds)
    ? profile.outbounds
    : Array.isArray(profile?.config?.outbounds)
      ? profile.config.outbounds
      : []
  return new Set(
    profileOutbounds
      .filter((outbound) => outbound?.type === 'selector' && outbound.hidden === true)
      .map((outbound) => outbound.tag)
      .filter(Boolean)
  )
}

const shouldPatchSelector = (outbound, generatedGroupTags, hiddenSelectorTags, settings) => {
  if (!outbound || outbound.type !== 'selector') return false
  if (generatedGroupTags.has(outbound.tag)) return false
  if (settings.skipHiddenSelectors && hiddenSelectorTags.has(outbound.tag)) return false
  return true
}

const cleanupMissingSelectorReferences = (config) => {
  const tags = new Set((config.outbounds || []).map((outbound) => outbound.tag).filter(Boolean))
  for (const outbound of config.outbounds || []) {
    if (!Array.isArray(outbound?.outbounds)) continue
    outbound.outbounds = outbound.outbounds.filter((tag) => tags.has(tag))
  }
}

const getCurrentProfile = () => {
  const profilesStore = Plugins.useProfilesStore()
  const appSettingsStore = Plugins.useAppSettingsStore()
  const profiles = profilesStore.profiles || []
  const currentProfileId = appSettingsStore.app?.kernel?.profile
  return profiles.find((profile) => profile.id === currentProfileId) || profilesStore.currentProfile || profiles[0]
}

const buildPreview = async (settings) => {
  const profile = getCurrentProfile()
  if (!profile) {
    return {
      profileName: '',
      groups: [],
      targetSelectors: []
    }
  }

  const generatedConfig = await Plugins.generateConfig(profile, { enablePluginProcessing: false }).catch(() => null)
  if (!generatedConfig?.outbounds) {
    return {
      profileName: profile.name || '',
      groups: [],
      targetSelectors: []
    }
  }

  const previewConfig = JSON.parse(JSON.stringify(generatedConfig))
  applyPolicyGroups(previewConfig, profile, settings)
  const generatedGroupTags = new Set(COUNTRY_GROUPS.map((group) => group.tag))
  return {
    profileName: profile.name || '',
    groups: previewConfig.outbounds
      .filter((outbound) => generatedGroupTags.has(outbound.tag))
      .map((outbound) => ({ tag: outbound.tag, count: outbound.outbounds?.length || 0 })),
    targetSelectors: previewConfig.outbounds
      .filter((outbound) => outbound.type === 'selector' && !generatedGroupTags.has(outbound.tag))
      .map((outbound) => outbound.tag)
  }
}

const openManager = async () => {
  const { ref, h } = Vue
  const settings = ref(normalizeSettings(await loadSettings()))
  const preview = ref(await buildPreview(settings.value))

  const refreshPreview = async () => {
    preview.value = await buildPreview(settings.value)
  }

  const component = {
    template: `
    <div class="flex flex-col gap-10 pr-8">
      <div class="flex items-center justify-between gap-8">
        <div class="min-w-0">
          <div class="font-bold text-16">策略组自动整理 <span class="text-12 opacity-70">{{ pluginVersion }}</span></div>
          <div class="text-12 opacity-70 truncate" :title="previewText">{{ previewText }}</div>
        </div>
        <div class="flex gap-8">
          <Button @click="refreshPreview">刷新预览</Button>
          <Button type="primary" @click="save">保存</Button>
        </div>
      </div>

      <Card>
        <div class="grid gap-10" style="grid-template-columns: 160px minmax(0, 1fr); align-items: center;">
          <div class="font-bold text-13">启用插件</div>
          <Switch v-model="settings.enabled">启用</Switch>

          <div class="font-bold text-13">插入位置</div>
          <select v-model="settings.insertPosition" class="gfs-native-input">
            <option value="before">插入到策略组前面</option>
            <option value="after">追加到策略组后面</option>
          </select>

          <div class="font-bold text-13">跳过隐藏策略组</div>
          <Switch v-model="settings.skipHiddenSelectors">跳过</Switch>

          <div class="font-bold text-13">台湾节点额外条件</div>
          <Input v-model="settings.taiwanPattern" placeholder="CN2|CFT" allow-paste />
        </div>
      </Card>

      <Card>
        <div class="grid gap-8" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));">
          <div v-for="group in preview.groups" :key="group.tag" class="rounded-4 p-8" style="border: 1px solid #cbd5e1; background: #f8fafc;">
            <div class="font-bold text-13">{{ group.tag }}</div>
            <div class="text-12 opacity-75">{{ group.count }} 个节点</div>
          </div>
          <div v-if="preview.groups.length === 0" class="flex items-center justify-center min-h-[80px] border border-dashed rounded-4" style="grid-column: 1 / -1;">
            <div class="text-12 opacity-70">当前预览没有生成国家策略组</div>
          </div>
        </div>
      </Card>

      <Card>
        <div class="font-bold text-13 mb-4">会被处理的策略组</div>
        <div class="text-12 opacity-75" style="word-break: break-word;">{{ targetSelectorText }}</div>
      </Card>
    </div>
    `,
    setup() {
      const save = async () => {
        const normalized = normalizeSettings(settings.value)
        validateSettings(normalized)
        getState().settings.value = normalized
        await saveSettings(normalized)
        await restartCoreIfRunning()
        modal.close()
      }

      return {
        pluginVersion: Plugin.version || '',
        settings,
        preview,
        previewText: Vue.computed(() => preview.value.profileName ? `预览配置：${preview.value.profileName}` : '未找到可预览配置'),
        targetSelectorText: Vue.computed(() => preview.value.targetSelectors.join('、') || '无'),
        refreshPreview,
        save
      }
    }
  }

  const modal = Plugins.modal(
    {
      title: '策略组自动整理',
      submit: false,
      width: '72',
      height: '72',
      cancelText: '关闭',
      afterClose() {
        modal.destroy()
      }
    },
    {
      default: () => h(component)
    }
  )
  modal.open()
}

const validateSettings = (settings) => {
  if (!settings.taiwanPattern) return
  try {
    new RegExp(settings.taiwanPattern)
  } catch (error) {
    throw `台湾节点额外条件正则无效：${error.message || error}`
  }
}

const restartCoreIfRunning = async () => {
  const kernelApiStore = Plugins.useKernelApiStore()
  if (!kernelApiStore.running) {
    Plugins.message.success('策略组整理配置已保存，启动核心后生效')
    return
  }
  Plugins.message.info('策略组整理配置已保存，正在重启核心...')
  await kernelApiStore.restartCore()
  Plugins.message.success('核心已重启，策略组整理已生效')
}

export default {
  onReady,
  onRun,
  onBeforeCoreStart
}
