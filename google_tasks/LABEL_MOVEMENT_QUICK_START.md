# Label Movement - Quick Start Guide

## What Is This?
Automatically move tasks to the right task lists based on hashtags in 
your task notes!

## How to Use

### Step 1: Add Hashtags to Your Tasks
Add hashtags to your task notes in Google Tasks:
```
Task: "Fix the fence"
Notes: "Repair broken boards #Phys"
```

### Step 2: Sync Your Tasks
Click "Sync Now" in the Google Tasks dashboard to fetch your tasks.

### Step 3: Process Labels
Click the green "Process Labels" button in the navbar.

### Step 4: Review Results
You'll see a summary:
- **Processed**: How many tasks were checked
- **Moved**: How many tasks were moved to new lists
- **Starred**: How many tasks were starred
- **Errors**: Any tasks that couldn't be processed

## Hashtag Format

### Valid Hashtags
- `#Work` - Minimum 3 letters
- `#Physical` - Any length
- `#Home` - Case doesn't matter

### Matching Rules
The system tries to match your hashtag with existing task lists:

1. **Exact Match**: `#Physical` → "Physical" list
2. **Partial Match (4 letters)**: `#Phys` → "Physical" list
3. **Partial Match (3 letters)**: `#Phy` → "Physical" list

### Examples

| Hashtag | Task List | Match Type |
|---------|-----------|------------|
| `#Work` | "Work" | Exact |
| `#Phys` | "Physical" | Partial (4 chars) |
| `#Sho` | "Shopping" | Partial (3 chars) |
| `#Home` | "Home" | Exact |

## What Happens to Your Tasks?

### Before
```
Task: "Buy groceries"
Notes: "Milk, bread, eggs #Shopping"
List: Tasks (default)
Starred: No
```

### After Processing
```
Task: "Buy groceries"
Notes: "Milk, bread, eggs #Shopping"
List: Shopping (moved!)
Starred: Yes (auto-starred!)
```

## Tips

### 1. Create Task Lists First
Make sure you have task lists that match your hashtags:
- "Physical" for `#Phys`
- "Work" for `#Work`
- "Shopping" for `#Shop`

### 2. Use Consistent Hashtags
Pick a hashtag format and stick with it:
- `#Work` (short)
- `#Physical` (full name)
- Either works, but be consistent!

### 3. Multiple Hashtags
If a task has multiple hashtags, only the first match is used:
```
Notes: "Important task #Work #Urgent"
Result: Moved to "Work" list (first match)
```

### 4. Already in Correct List?
If a task is already in the matching list, it just gets starred:
```
Task in "Work" list with "#Work" hashtag
Result: Stays in "Work", gets starred
```

## Troubleshooting

### "No tasks moved"
- Check that your tasks have hashtags
- Make sure hashtags match your task list names (at least first 3 
  letters)
- Verify you have multiple task lists created

### "Reauth required"
- Click the authorization link to re-authenticate with Google
- This happens when your Google credentials expire

### "Processing failed"
- Check your internet connection
- Make sure you're logged in
- Try syncing tasks first

## Advanced Usage

### Process Single Task
Currently, the UI processes all active tasks. To process a single task, 
you can use the API endpoint:
```
POST /tasks/task/<task_id>/process-label/
```

### View Processing Details
Check the browser console (F12) for detailed processing logs.

## FAQ

**Q: Will my original notes be changed?**  
A: No, hashtags stay in your notes. Only the task list and starred 
status change.

**Q: Can I undo label processing?**  
A: Not automatically. You'll need to manually move tasks back and 
unstar them.

**Q: Does this work with completed tasks?**  
A: No, only active (non-completed) tasks are processed.

**Q: How often should I process labels?**  
A: Whenever you've added new hashtags to your tasks. It's safe to run 
multiple times.

**Q: What if I don't have a matching task list?**  
A: The task will be skipped and stay in its current list.

## Example Workflow

1. **Morning**: Add tasks with hashtags
   ```
   "Call plumber #Home"
   "Finish report #Work"
   "Buy paint #Shopping"
   ```

2. **Sync**: Click "Sync Now" to fetch from Google

3. **Process**: Click "Process Labels"

4. **Result**: 
   - "Call plumber" → Home list (starred)
   - "Finish report" → Work list (starred)
   - "Buy paint" → Shopping list (starred)

5. **View**: Filter by task list to see organized tasks!

## Need Help?

- Check the full documentation: `README.md`
- Review implementation details: 
  `LABEL_MOVEMENT_IMPLEMENTATION_SUMMARY.md`
- See the planning doc: `LABEL_MOVEMENT_PLAN.md`
- GitHub Issue: https://github.com/Ted-Rose/django-apps/issues/6

---

**Happy organizing! 🏷️✨**
