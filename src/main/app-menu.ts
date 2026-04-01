import { Menu, app } from 'electron'

interface MenuTranslations {
  app: { about: string; services: string; hide: string; hideOthers: string; showAll: string; quit: string }
  file: { label: string; closeWindow: string }
  edit: { label: string; undo: string; redo: string; cut: string; copy: string; paste: string; selectAll: string }
  view: { label: string; reload: string; forceReload: string; toggleDevTools: string; resetZoom: string; zoomIn: string; zoomOut: string; toggleFullScreen: string }
  window: { label: string; minimize: string; zoom: string; front: string }
  help: { label: string }
}

const locales: Record<string, MenuTranslations> = {
  en: {
    app: { about: 'About Clave', services: 'Services', hide: 'Hide Clave', hideOthers: 'Hide Others', showAll: 'Show All', quit: 'Quit Clave' },
    file: { label: 'File', closeWindow: 'Close Window' },
    edit: { label: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All' },
    view: { label: 'View', reload: 'Reload', forceReload: 'Force Reload', toggleDevTools: 'Toggle Developer Tools', resetZoom: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', toggleFullScreen: 'Toggle Full Screen' },
    window: { label: 'Window', minimize: 'Minimize', zoom: 'Zoom', front: 'Bring All to Front' },
    help: { label: 'Help' }
  },
  'zh-CN': {
    app: { about: '关于 Clave', services: '服务', hide: '隐藏 Clave', hideOthers: '隐藏其他', showAll: '显示全部', quit: '退出 Clave' },
    file: { label: '文件', closeWindow: '关闭窗口' },
    edit: { label: '编辑', undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选' },
    view: { label: '显示', reload: '重新加载', forceReload: '强制重新加载', toggleDevTools: '切换开发者工具', resetZoom: '实际大小', zoomIn: '放大', zoomOut: '缩小', toggleFullScreen: '切换全屏' },
    window: { label: '窗口', minimize: '最小化', zoom: '缩放', front: '前置全部窗口' },
    help: { label: '帮助' }
  }
}

let currentLanguage = 'en'

function m(): MenuTranslations {
  return locales[currentLanguage] || locales.en
}

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin'
  const t = m()
  const template: Electron.MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { label: t.app.about, role: 'about' },
        { type: 'separator' },
        { label: t.app.services, role: 'services' },
        { type: 'separator' },
        { label: t.app.hide, role: 'hide' },
        { label: t.app.hideOthers, role: 'hideOthers' },
        { label: t.app.showAll, role: 'unhide' },
        { type: 'separator' },
        { label: t.app.quit, role: 'quit' }
      ]
    })
  }

  template.push({
    label: t.file.label,
    submenu: [
      isMac
        ? { label: t.file.closeWindow, role: 'close' }
        : { label: t.app.quit, role: 'quit' }
    ]
  })

  template.push({
    label: t.edit.label,
    submenu: [
      { label: t.edit.undo, role: 'undo' },
      { label: t.edit.redo, role: 'redo' },
      { type: 'separator' },
      { label: t.edit.cut, role: 'cut' },
      { label: t.edit.copy, role: 'copy' },
      { label: t.edit.paste, role: 'paste' },
      { label: t.edit.selectAll, role: 'selectAll' }
    ]
  })

  template.push({
    label: t.view.label,
    submenu: [
      { label: t.view.reload, role: 'reload' },
      { label: t.view.forceReload, role: 'forceReload' },
      { label: t.view.toggleDevTools, role: 'toggleDevTools' },
      { type: 'separator' },
      { label: t.view.resetZoom, role: 'resetZoom' },
      { label: t.view.zoomIn, role: 'zoomIn' },
      { label: t.view.zoomOut, role: 'zoomOut' },
      { type: 'separator' },
      { label: t.view.toggleFullScreen, role: 'togglefullscreen' }
    ]
  })

  template.push({
    label: t.window.label,
    submenu: [
      { label: t.window.minimize, role: 'minimize' },
      { label: t.window.zoom, role: 'zoom' },
      ...(isMac
        ? [
            { type: 'separator' as const },
            { label: t.window.front, role: 'front' as const }
          ]
        : [])
    ]
  })

  template.push({
    label: t.help.label,
    role: 'help',
    submenu: []
  })

  return Menu.buildFromTemplate(template)
}

export function initAppMenu(lang?: string): void {
  if (lang) currentLanguage = lang
  Menu.setApplicationMenu(buildMenu())
}

export function setMenuLanguage(lang: string): void {
  currentLanguage = lang
  Menu.setApplicationMenu(buildMenu())
}
