;(function () {
  var DARK_COLOR = '#000000'
  var LIGHT_COLOR = '#f2f2f7'
  var isSharePage = window.location.pathname.indexOf('/share/') === 0
  var dark = window.matchMedia('(prefers-color-scheme: dark)').matches

  if (!isSharePage) {
    try {
      var raw = window.localStorage.getItem('moods_settings')
      var settings = raw ? JSON.parse(raw) : null
      dark = Boolean(settings && settings.darkMode === true)
    } catch {
      dark = false
    }
  }

  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  var themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor) themeColor.setAttribute('content', dark ? DARK_COLOR : LIGHT_COLOR)
})()
