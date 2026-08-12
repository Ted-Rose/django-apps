# Reusable Components

This directory contains reusable Django template components that can
be used across different apps.

## Burger Menu Component

Location: `components/burger_menu.html`

A responsive burger menu that shows buttons on desktop and collapses
into a hamburger icon on mobile devices.

### Usage

1. **In your view**, create a list of menu items:

```python
burger_menu_items = [
    {
        'label': 'Home',
        'url': '/',
        'icon': 'house',  # Bootstrap icon name (optional)
        'btn_class': 'btn-outline-light'  # Optional, default: btn-light
    },
    {
        'label': 'Process Labels',
        'onclick': 'processLabels()',  # JavaScript function
        'icon': 'tags',
        'btn_class': 'btn-success'
    },
    {
        'label': 'Sync Now',
        'url': '?sync=true',
        'icon': 'arrow-repeat',
        'btn_class': 'btn-light'
    },
]

context = {
    # ... other context variables
    'burger_menu_items': burger_menu_items,
}
```

2. **In your template**, include the component:

```django
{% include "components/burger_menu.html" with menu_items=burger_menu_items %}
```

### Menu Item Properties

- `label` (required): The text displayed on the button
- `url` (optional): The link URL (for anchor tags)
- `onclick` (optional): JavaScript function to execute (for buttons)
- `icon` (optional): Bootstrap icon class name (without 'bi-' prefix)
- `btn_class` (optional): Additional CSS classes for the button
  (default: 'btn-light')

**Note**: Each menu item must have either a `url` or `onclick` property.

### Responsive Behavior

- **Desktop (>768px)**: Shows all buttons in a horizontal row
- **Mobile (≤768px)**: Shows a hamburger icon that toggles a dropdown
  menu

### Example

See `google_tasks/views.py` and
`google_tasks/templates/google_tasks/dashboard.html` for a complete
implementation example.
