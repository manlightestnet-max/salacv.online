const themes = {
  blue:   { '--accent': '#0066FF' },
  violet: { '--accent': '#7C3AED' },
  terra:  { '--accent': '#C4622D' },
  noir:   { '--accent': '#1A1A18' },
}

function setTheme(key) {
  const vars = themes[key]
  if (!vars) return
  const root = document.documentElement
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v))
  localStorage.setItem('smlab-theme', key)
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('smlab-theme')
  if (saved && themes[saved]) {
    setTheme(saved)
    const sel = document.getElementById('themeSelect')
    if (sel) sel.value = saved
  }
})
