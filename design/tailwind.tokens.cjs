/* Mysl (Мысль) Tailwind mapping. Generated from tokens.json. Every value points at a CSS
   variable from tokens.css, so the dark theme and the rebrand need no Tailwind change.
   Usage: module.exports = { darkMode: ['selector', '[data-theme="dark"]'],
            theme: { extend: require('./tailwind.tokens.js').extend } } */
/* spacing keys: Tailwind's 4px scale (1=4px, 2=8px, 3=12px, 4=16px, 6=24px, 8=32px, 12=48px, 16=64px) is kept as is. */
module.exports = {
  extend: {
    "colors": {
      "bg": "var(--color-bg)",
      "surface": "var(--color-surface)",
      "surface-hover": "var(--color-surface-hover)",
      "surface-active": "var(--color-surface-active)",
      "border": "var(--color-border)",
      "border-input": "var(--color-border-input)",
      "text": "var(--color-text)",
      "text-muted": "var(--color-text-muted)",
      "text-disabled": "var(--color-text-disabled)",
      "accent": "var(--color-accent)",
      "accent-hover": "var(--color-accent-hover)",
      "accent-subtle": "var(--color-accent-subtle)",
      "on-accent": "var(--color-on-accent)",
      "focus": "var(--color-focus)",
      "danger": "var(--color-danger)",
      "danger-subtle": "var(--color-danger-subtle)",
      "on-danger": "var(--color-on-danger)",
      "success": "var(--color-success)",
      "success-subtle": "var(--color-success-subtle)",
      "warning": "var(--color-warning)",
      "warning-subtle": "var(--color-warning-subtle)",
      "tooltip-bg": "var(--color-tooltip-bg)",
      "tooltip-text": "var(--color-tooltip-text)",
      "chip-bg": "var(--color-chip-bg)",
      "chip-text": "var(--color-chip-text)",
      "canvas-bg": "var(--color-canvas-bg)",
      "canvas-grid": "var(--color-canvas-grid)",
      "selection": "var(--color-selection)",
      "selection-handle": "var(--color-selection-handle)",
      "guide": "var(--color-guide)",
      "frame-title": "var(--color-frame-title)",
      "frame-fill": "var(--color-frame-fill)",
      "selection-fill": "var(--color-selection-fill)",
      "scrim": "var(--color-scrim)",
      "sticky": {
        "lemon": {
          "DEFAULT": "var(--sticky-lemon-fill)",
          "text": "var(--sticky-lemon-text)"
        },
        "apricot": {
          "DEFAULT": "var(--sticky-apricot-fill)",
          "text": "var(--sticky-apricot-text)"
        },
        "coral": {
          "DEFAULT": "var(--sticky-coral-fill)",
          "text": "var(--sticky-coral-text)"
        },
        "rose": {
          "DEFAULT": "var(--sticky-rose-fill)",
          "text": "var(--sticky-rose-text)"
        },
        "lilac": {
          "DEFAULT": "var(--sticky-lilac-fill)",
          "text": "var(--sticky-lilac-text)"
        },
        "sky": {
          "DEFAULT": "var(--sticky-sky-fill)",
          "text": "var(--sticky-sky-text)"
        },
        "aqua": {
          "DEFAULT": "var(--sticky-aqua-fill)",
          "text": "var(--sticky-aqua-text)"
        },
        "mint": {
          "DEFAULT": "var(--sticky-mint-fill)",
          "text": "var(--sticky-mint-text)"
        },
        "lime": {
          "DEFAULT": "var(--sticky-lime-fill)",
          "text": "var(--sticky-lime-text)"
        },
        "stone": {
          "DEFAULT": "var(--sticky-stone-fill)",
          "text": "var(--sticky-stone-text)"
        },
        "slate": {
          "DEFAULT": "var(--sticky-slate-fill)",
          "text": "var(--sticky-slate-text)"
        },
        "ink": {
          "DEFAULT": "var(--sticky-ink-fill)",
          "text": "var(--sticky-ink-text)"
        }
      },
      "tag": {
        "red": {
          "DEFAULT": "var(--tag-red-bg)",
          "text": "var(--tag-red-text)"
        },
        "orange": {
          "DEFAULT": "var(--tag-orange-bg)",
          "text": "var(--tag-orange-text)"
        },
        "amber": {
          "DEFAULT": "var(--tag-amber-bg)",
          "text": "var(--tag-amber-text)"
        },
        "green": {
          "DEFAULT": "var(--tag-green-bg)",
          "text": "var(--tag-green-text)"
        },
        "teal": {
          "DEFAULT": "var(--tag-teal-bg)",
          "text": "var(--tag-teal-text)"
        },
        "blue": {
          "DEFAULT": "var(--tag-blue-bg)",
          "text": "var(--tag-blue-text)"
        },
        "indigo": {
          "DEFAULT": "var(--tag-indigo-bg)",
          "text": "var(--tag-indigo-text)"
        },
        "violet": {
          "DEFAULT": "var(--tag-violet-bg)",
          "text": "var(--tag-violet-text)"
        },
        "pink": {
          "DEFAULT": "var(--tag-pink-bg)",
          "text": "var(--tag-pink-text)"
        },
        "brown": {
          "DEFAULT": "var(--tag-brown-bg)",
          "text": "var(--tag-brown-text)"
        },
        "grey": {
          "DEFAULT": "var(--tag-grey-bg)",
          "text": "var(--tag-grey-text)"
        },
        "black": {
          "DEFAULT": "var(--tag-black-bg)",
          "text": "var(--tag-black-text)"
        }
      },
      "cursor": {
        "c1": {
          "DEFAULT": "var(--cursor-c1-fill)",
          "label": "var(--cursor-c1-label)"
        },
        "c2": {
          "DEFAULT": "var(--cursor-c2-fill)",
          "label": "var(--cursor-c2-label)"
        },
        "c3": {
          "DEFAULT": "var(--cursor-c3-fill)",
          "label": "var(--cursor-c3-label)"
        },
        "c4": {
          "DEFAULT": "var(--cursor-c4-fill)",
          "label": "var(--cursor-c4-label)"
        },
        "c5": {
          "DEFAULT": "var(--cursor-c5-fill)",
          "label": "var(--cursor-c5-label)"
        },
        "c6": {
          "DEFAULT": "var(--cursor-c6-fill)",
          "label": "var(--cursor-c6-label)"
        },
        "c7": {
          "DEFAULT": "var(--cursor-c7-fill)",
          "label": "var(--cursor-c7-label)"
        },
        "c8": {
          "DEFAULT": "var(--cursor-c8-fill)",
          "label": "var(--cursor-c8-label)"
        }
      }
    },
    "fontFamily": {
      "sans": [
        "var(--font-sans)"
      ],
      "mono": [
        "var(--font-mono)"
      ]
    },
    "fontSize": {
      "xs": [
        "var(--text-xs-size)",
        {
          "lineHeight": "var(--text-xs-line)",
          "fontWeight": "var(--text-xs-weight)"
        }
      ],
      "sm": [
        "var(--text-sm-size)",
        {
          "lineHeight": "var(--text-sm-line)",
          "fontWeight": "var(--text-sm-weight)"
        }
      ],
      "base": [
        "var(--text-base-size)",
        {
          "lineHeight": "var(--text-base-line)",
          "fontWeight": "var(--text-base-weight)"
        }
      ],
      "lg": [
        "var(--text-lg-size)",
        {
          "lineHeight": "var(--text-lg-line)",
          "fontWeight": "var(--text-lg-weight)"
        }
      ],
      "xl": [
        "var(--text-xl-size)",
        {
          "lineHeight": "var(--text-xl-line)",
          "fontWeight": "var(--text-xl-weight)"
        }
      ],
      "display": [
        "var(--text-display-size)",
        {
          "lineHeight": "var(--text-display-line)",
          "fontWeight": "var(--text-display-weight)"
        }
      ]
    },
    "borderRadius": {
      "xs": "var(--radius-xs)",
      "sm": "var(--radius-sm)",
      "md": "var(--radius-md)",
      "lg": "var(--radius-lg)",
      "pill": "var(--radius-pill)"
    },
    "boxShadow": {
      "card": "var(--shadow-card)",
      "toolbar": "var(--shadow-toolbar)",
      "pop": "var(--shadow-pop)",
      "sticky": "var(--sticky-shadow)"
    },
    "transitionDuration": {
      "fast": "var(--motion-fast)",
      "base": "var(--motion-base)",
      "slow": "var(--motion-slow)"
    },
    "transitionTimingFunction": {
      "DEFAULT": "var(--motion-ease)",
      "out-soft": "var(--motion-ease)"
    },
    "zIndex": {
      "canvas": "var(--z-canvas)",
      "canvas-overlay": "var(--z-canvas-overlay)",
      "toolbar": "var(--z-toolbar)",
      "panel": "var(--z-panel)",
      "popover": "var(--z-popover)",
      "modal": "var(--z-modal)",
      "toast": "var(--z-toast)",
      "tooltip": "var(--z-tooltip)"
    },
    "width": {
      "side-panel": "var(--layout-side-panel)",
      "dashboard-sidebar": "var(--layout-dashboard-sidebar)"
    },
    "height": {
      "topbar": "var(--layout-topbar-height)",
      "control-sm": "var(--size-control-sm)",
      "control-md": "var(--size-control-md)",
      "control-lg": "var(--size-control-lg)"
    },
    "maxWidth": {
      "content": "var(--layout-content-max)",
      "modal-sm": "var(--layout-modal-sm)",
      "modal-md": "var(--layout-modal-md)",
      "modal-lg": "var(--layout-modal-lg)"
    },
    "outlineColor": {
      "focus": "var(--color-focus)"
    },
    "ringColor": {
      "focus": "var(--color-focus)"
    },
    "screens": {
      "sm": "640px",
      "md": "768px",
      "lg": "1024px",
      "xl": "1280px"
    }
  },

};
