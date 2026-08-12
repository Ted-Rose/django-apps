# Task Divider - Quick Start Guide

## What Is This?
Visually organize your tasks into groups using dividers (horizontal lines)
between tasks!

## How to Use

### Step 1: Navigate to Your Tasks
Go to the Google Tasks dashboard to view your task lists.

### Step 2: Add a Divider
Click the "Add Divider" button in the filter bar to create a new divider.

### Step 3: Position the Divider
Drag and drop the divider to the desired position between your tasks.

### Step 4: Delete a Divider (Optional)
Hover over a divider and click the X button to remove it.

## What Are Dividers?

Dividers are visual separators that help you organize tasks into logical
groups or sections. They appear as horizontal dashed lines between tasks.

### Visual Example
```
Task 1: Buy groceries
Task 2: Call dentist
─────────────────────  ← Divider
Task 3: Review project proposal
Task 4: Send weekly report
─────────────────────  ← Divider
Task 5: Plan weekend trip
```

## Key Features

### 1. Easy Creation
- Click "Add Divider" button
- Divider appears at the bottom of the task list
- Drag to desired position

### 2. Drag and Drop
- Dividers can be moved just like tasks
- Use the grip icon to drag
- Position anywhere in your task list

### 3. Easy Deletion
- Hover over divider to reveal delete button
- Click X to remove
- Confirmation dialog prevents accidental deletion

### 4. Local-Only
- Dividers are stored locally in your database
- They do NOT sync to Google Tasks
- Perfect for personal organization

## Use Cases

### Organize by Priority
```
High Priority Tasks
─────────────────────
Medium Priority Tasks
─────────────────────
Low Priority Tasks
```

### Organize by Category
```
Work Tasks
─────────────────────
Personal Tasks
─────────────────────
Shopping Tasks
```

### Organize by Timeline
```
Today
─────────────────────
This Week
─────────────────────
Later
```

## Tips

### 1. Use Multiple Dividers
Create as many dividers as you need to organize your tasks effectively.

### 2. Combine with Task Lists
Use dividers within specific task lists for even better organization.

### 3. Combine with Starred Tasks
Dividers work in all views, including the Starred view.

### 4. Reorder Anytime
Drag dividers to new positions as your task organization changes.

## Troubleshooting

### "Add Divider" Button Not Working
- Make sure you have at least one task list
- Check that you're viewing a specific task list or "All Tasks"
- Try refreshing the page

### Divider Not Appearing
- Check that you're viewing the correct task list
- Dividers appear at the bottom initially - scroll down
- Try refreshing the page

### Can't Delete Divider
- Make sure you're hovering over the divider to reveal the X button
- Check that you have permission to modify tasks
- Try refreshing the page

## Advanced Usage

### Keyboard Navigation
- Tab to navigate to dividers
- Enter to activate delete button
- Escape to cancel deletion

### Multiple Task Lists
- Dividers are specific to each task list
- Create different organizational structures for different lists
- Move dividers between positions within the same list

## FAQ

**Q: Will dividers sync to Google Tasks?**  
A: No, dividers are local-only and won't appear in Google Tasks.

**Q: Can I add text to dividers?**  
A: Not currently. Dividers are simple visual separators without labels.

**Q: What happens if I delete a task list?**  
A: All dividers in that list will be deleted too.

**Q: Can I have dividers in completed tasks?**  
A: Dividers only appear in active tasks, not in the completed section.

**Q: How many dividers can I create?**  
A: No limit. Create as many as you need.

**Q: Can I change the divider style?**  
A: Not currently. All dividers use the same dashed line style.

## Example Workflow

### Morning Organization
1. **Review Tasks**: Look at all your tasks for the day
2. **Add Dividers**: Click "Add Divider" 2-3 times
3. **Organize**: Drag dividers to separate:
   - Urgent tasks
   - Regular tasks
   - Later tasks
4. **Work Through**: Complete tasks section by section

### Project Organization
1. **Create Dividers**: Add dividers between project phases
2. **Group Tasks**: Drag tasks into appropriate sections:
   - Planning
   - ─────────────
   - Development
   - ─────────────
   - Testing
   - ─────────────
   - Deployment

## Visual States

### Normal State
```
⠿ ───────────────────────────────────
```
- Dashed gray line
- Drag handle visible

### Hover State
```
⠿ ─────────────────────────────── ⊗
```
- Line changes to blue
- Delete button appears
- Cursor changes to grab

### Dragging State
```
⠿ ─────────────────────────────── (ghost)
```
- Semi-transparent while dragging
- Other tasks shift to show drop position

## Integration with Other Features

### Works With Starred View
- Dividers appear in starred tasks view
- Organize starred tasks into sections

### Works With Task List Filtering
- Each task list can have its own dividers
- Filter by list to see list-specific organization

### Works With Drag-and-Drop Reordering
- Dividers use the same ordering system as tasks
- Drag both tasks and dividers to organize

## Need Help?

- Check the full documentation: `TASK_DIVIDER_IMPLEMENTATION_PLAN.md`
- Review the summary: `TASK_DIVIDER_SUMMARY.md`
- See the UI mockup: `TASK_DIVIDER_UI_MOCKUP.md`
- GitHub Issue: https://github.com/Ted-Rose/django-apps/issues/3

---

**Happy organizing! 📋✨**
