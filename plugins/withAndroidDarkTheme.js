// Android: AppCompat temasını her zaman koyu yapar ve vurgu rengini marka yeşiline çeker.
// Böylece Alert diyalogları, seçim menüleri vb. sistem açık temada olsa da koyu görünür.
const { withAndroidStyles, withAndroidColors, AndroidConfig } = require('@expo/config-plugins');

const PRIMARY = '#22C55E';
const SURFACE = '#121821';

function withAndroidDarkTheme(config) {
  config = withAndroidColors(config, (c) => {
    c.modResults = AndroidConfig.Colors.assignColorValue(c.modResults, { name: 'colorPrimary', value: PRIMARY });
    c.modResults = AndroidConfig.Colors.assignColorValue(c.modResults, { name: 'colorAccent', value: PRIMARY });
    c.modResults = AndroidConfig.Colors.assignColorValue(c.modResults, { name: 'dialogBackground', value: SURFACE });
    return c;
  });

  config = withAndroidStyles(config, (c) => {
    const styles = c.modResults;
    const appTheme = styles.resources.style?.find((s) => s.$.name === 'AppTheme');
    if (appTheme) {
      appTheme.$.parent = 'Theme.AppCompat.NoActionBar';
      const set = (name, value) => {
        appTheme.item = appTheme.item ?? [];
        const existing = appTheme.item.find((i) => i.$.name === name);
        if (existing) existing._ = value;
        else appTheme.item.push({ $: { name }, _: value });
      };
      set('colorAccent', '@color/colorAccent');
      set('alertDialogTheme', '@style/Theme.App.Dialog');
      set('android:alertDialogTheme', '@style/Theme.App.Dialog');
    }

    styles.resources.style = styles.resources.style ?? [];
    if (!styles.resources.style.some((s) => s.$.name === 'Theme.App.Dialog')) {
      styles.resources.style.push({
        $: { name: 'Theme.App.Dialog', parent: 'Theme.AppCompat.Dialog.Alert' },
        item: [
          { $: { name: 'colorAccent' }, _: '@color/colorAccent' },
          { $: { name: 'android:background' }, _: '@color/dialogBackground' },
          { $: { name: 'android:textColorPrimary' }, _: '#F1F5F9' },
          { $: { name: 'android:textColorSecondary' }, _: '#CBD5E1' },
          // Butonlar colorAccent (yeşil) kullanır; android:textColor verilmez.
        ],
      });
    }
    return c;
  });

  return config;
}

module.exports = withAndroidDarkTheme;
