# category-overview Specification

## Purpose
The finance category-overview page lets a signed-in user see how
spending distributes across their categories over a chosen time
window, drill into a category's transactions, and share the
overview with another user.

## Requirements

### Requirement: Time-window selection

The page SHALL default to the current-month window when no date
parameters are present, render only the month preset chips next
to a calendar toggle that opens the custom from/to/account
filter form, and place the Last year and All time quick ranges
inside that form. No separate summary of the active window is
shown — the active chip or the form's fields convey it. All
time SHALL be an explicit range starting 2000-01-01.

#### Scenario: Bare visit defaults to the current month

- **WHEN** the user opens the page without from/to parameters
- **THEN** the overview loads the current month and the This
  month chip appears active

#### Scenario: Preset chip selects a window

- **WHEN** the user clicks a preset period chip
- **THEN** the overview reloads for that window and the chip
  appears active

#### Scenario: Calendar toggle opens the filter form

- **WHEN** the user clicks the calendar icon next to the period
  chips
- **THEN** the from/to/account filter form expands beneath the
  chips, showing the effective window in its fields plus Last
  year and All time quick-range buttons

#### Scenario: All time quick range covers all history

- **WHEN** the user clicks All time inside the filter form
- **THEN** the overview reloads for a range starting at
  2000-01-01 through today

### Requirement: Spending breakdown table

The page SHALL show one row per category with its name,
transaction count, spending-share bar, and spent amount, and
SHALL NOT render a per-category received column or a totals
footer inside the table.

#### Scenario: Row columns

- **WHEN** the breakdown table renders
- **THEN** each row shows the category badge, share bar, and spent
  amount with no received column

#### Scenario: Row opens the transaction drill-down

- **WHEN** the user clicks a category row
- **THEN** the transaction drill-down for that category opens
  beneath the breakdown table, the selection is reflected in the
  URL, and the panel's close button clears it

### Requirement: Window totals below the table

Per-currency spent and received totals SHALL render as summary
cards below the breakdown table and monthly matrix, not above
them.

#### Scenario: Totals placement

- **WHEN** the overview has transactions
- **THEN** the spent/received summary cards appear beneath the
  breakdown table near the bottom of the page

#### Scenario: Category management at the bottom

- **WHEN** the overview renders the caller's own view
- **THEN** the category management card sits beneath the totals
  cards at the bottom of the page

### Requirement: Spending-share chart values

The chart tooltip and selection readout SHALL show the category's
share as a whole-number percentage together with its absolute
spent amount and currency.

#### Scenario: Slice hover shows amount and rounded share

- **WHEN** the user hovers a chart slice
- **THEN** the tooltip shows the rounded percentage and the
  category's spent amount with currency

### Requirement: Chart slice and legend selection

Clicking a chart slice or its legend entry SHALL select that
category and display its share and spent amount; legend entries
SHALL behave as clickable buttons.

#### Scenario: Legend entry acts as a button

- **WHEN** the user clicks a legend entry
- **THEN** that category's rounded share and spent amount are
  displayed

#### Scenario: Slice click selects the category

- **WHEN** the user clicks a chart slice
- **THEN** the same share and amount readout is shown for that
  category

### Requirement: Share affordance in the page header

The control for sharing the caller's own overview SHALL be a
compact icon button in the page header's action area beside the
title, not a standalone row under the header.

#### Scenario: Share toggle in header

- **WHEN** the user views their own overview
- **THEN** a compact share icon button sits in the header actions
  and opens the share form
