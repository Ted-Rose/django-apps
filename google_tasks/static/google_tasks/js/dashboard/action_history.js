/**
 * Undo/redo history for task actions.
 */

class ActionHistory {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.maxStackSize = 50;
        this.storageKey = 'taskActionHistory';
        this.loadFromStorage();
        this.updateUI();
    }

    recordAction(action) {
        this.undoStack.push({
            ...action,
            timestamp: Date.now()
        });

        if (this.undoStack.length > this.maxStackSize) {
            this.undoStack.shift();
        }

        this.redoStack = [];
        this.saveToStorage();
        this.updateUI();
    }

    canUndo() {
        return this.undoStack.length > 0;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    getLastAction() {
        return this.undoStack[this.undoStack.length - 1];
    }

    undo() {
        if (!this.canUndo()) return null;

        const action = this.undoStack.pop();
        this.redoStack.push(action);
        this.saveToStorage();
        this.updateUI();
        return action;
    }

    redo() {
        if (!this.canRedo()) return null;

        const action = this.redoStack.pop();
        this.undoStack.push(action);
        this.saveToStorage();
        this.updateUI();
        return action;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.saveToStorage();
        this.updateUI();
    }

    saveToStorage() {
        try {
            const data = {
                undoStack: this.undoStack.slice(-this.maxStackSize),
                redoStack: this.redoStack.slice(-this.maxStackSize)
            };
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save action history:', e);
        }
    }

    loadFromStorage() {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                const parsed = JSON.parse(data);
                this.undoStack = parsed.undoStack || [];
                this.redoStack = parsed.redoStack || [];
            }
        } catch (e) {
            console.warn('Failed to load action history:', e);
            this.undoStack = [];
            this.redoStack = [];
        }
    }

    updateUI() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');

        if (undoBtn) {
            undoBtn.disabled = !this.canUndo();
        }
        if (redoBtn) {
            redoBtn.disabled = !this.canRedo();
        }
    }
}

const actionHistory = new ActionHistory();

function performUndo() {
    const action = actionHistory.undo();
    if (!action) return;

    switch(action.type) {
        case 'TOGGLE_STAR':
            toggleStar(action.taskId, true);
            showToast(`Undid ${action.previousState ? 'unstar' : 'star'} action`);
            break;

        case 'COMPLETE_TASK':
            currentTaskId = action.taskId;
            uncompleteTask(true);
            showToast(`Undid complete: ${action.taskTitle}`);
            break;

        case 'UNCOMPLETE_TASK':
            currentTaskId = action.taskId;
            completeTask(true);
            showToast(`Undid uncomplete: ${action.taskTitle}`);
            break;

        case 'ARCHIVE_TASK':
            showToast(`Cannot undo archive - please restore from Archive view`);
            actionHistory.recordAction(action);
            break;

        case 'DELETE_TASK':
            showToast(`Cannot undo delete - please restore from Trash view`);
            actionHistory.recordAction(action);
            break;

        case 'DELETE_DIVIDER':
            showToast(`Cannot undo divider deletion - please recreate manually`);
            actionHistory.recordAction(action);
            break;

        case 'UPDATE_DIVIDER':
            const dividerInput = document.querySelector(`[data-task-id="${action.taskId}"] .divider-text`);
            if (dividerInput) {
                dividerInput.value = action.previousText;
                updateDividerText(dividerInput, true);
                showToast(`Undid divider text update`);
            }
            break;

        case 'REORDER_TASKS':
            reorderTasksToOrder(action.previousOrder);
            showToast(`Undid task reorder`);
            break;
    }
}

function performRedo() {
    const action = actionHistory.redo();
    if (!action) return;

    switch(action.type) {
        case 'TOGGLE_STAR':
            toggleStar(action.taskId, true);
            showToast(`Redid ${action.previousState ? 'star' : 'unstar'} action`);
            break;

        case 'COMPLETE_TASK':
            currentTaskId = action.taskId;
            completeTask(true);
            showToast(`Redid complete: ${action.taskTitle}`);
            break;

        case 'UNCOMPLETE_TASK':
            currentTaskId = action.taskId;
            uncompleteTask(true);
            showToast(`Redid uncomplete: ${action.taskTitle}`);
            break;

        case 'UPDATE_DIVIDER':
            const dividerInput = document.querySelector(`[data-task-id="${action.taskId}"] .divider-text`);
            if (dividerInput) {
                dividerInput.value = action.newText;
                updateDividerText(dividerInput, true);
                showToast(`Redid divider text update`);
            }
            break;

        case 'REORDER_TASKS':
            reorderTasksToOrder(action.newOrder);
            showToast(`Redid task reorder`);
            break;

        default:
            showToast(`Cannot redo this action`);
            break;
    }
}
