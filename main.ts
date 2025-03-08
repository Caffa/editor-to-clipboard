import { App, Plugin, PluginSettingTab, Setting, MarkdownView, Notice, Modal, TFile, SettingTab } from 'obsidian';

interface EditorToClipboardSettings {
    removeMetadata: boolean;
    removeBlockIds: boolean;
    // Combined position settings
    copyButtonPosition: 'ribbon' | 'hidden' | 'floating-left-top' | 'floating-left-middle' | 'floating-left-bottom' | 'floating-right-top' | 'floating-right-middle' | 'floating-right-bottom';
    saveButtonPosition: 'ribbon' | 'hidden' | 'floating-left-top' | 'floating-left-middle' | 'floating-left-bottom' | 'floating-right-top' | 'floating-right-middle' | 'floating-right-bottom';
    defaultSaveLocation: string;
    fileNamePrefix: string;
    openNewFile: boolean; // New setting to control auto-opening files
}

const DEFAULT_SETTINGS: EditorToClipboardSettings = {
    removeMetadata: true,
    removeBlockIds: true, // Default to true as requested
    copyButtonPosition: 'ribbon', // Default to ribbon
    saveButtonPosition: 'ribbon', // Default to ribbon
    defaultSaveLocation: "", // Empty means user will be prompted
    fileNamePrefix: "(Plain) ",
    openNewFile: true // Default to true for better user experience
}

export default class EditorToClipboardPlugin extends Plugin {
    settings: EditorToClipboardSettings;
    saveButtonEl: HTMLElement | null = null;
    clipboardButtonEl: HTMLElement | null = null;
    floatingButtonsContainer: HTMLElement | null = null;
    topOfNoteButtonsContainer: HTMLElement | null = null;
    private leafChangeEvent: any = null; // Track the event reference
    floatingCopyContainer: HTMLElement | null = null;
    floatingSaveContainer: HTMLElement | null = null;
    private positionUpdateTimeout: NodeJS.Timeout | null = null;

    async onload() {
        await this.loadSettings();
        console.log('Loading Editor to Clipboard Plugin');

        // Command without default hotkey - users can set their own
        this.addCommand({
            id: 'copy-active-editor-content',
            name: 'Copy active editor content to clipboard',
            callback: () => {
                this.OneClickClipboard();
            }
        });

        // Command without default hotkey - users can set their own
        this.addCommand({
            id: 'save-active-editor-content',
            name: 'Save active editor content to a file',
            callback: () => {
                this.saveToFile();
            }
        });

        // Add buttons based on settings
        this.updateButtonLocations();

        // Add settings tab
        this.addSettingTab(new EditorToClipboardSettingTab(this.app, this));

        // Register event for layout changes to handle settings visibility
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                if (this.isSettingsOpen()) {
                    this.hideFloatingButtons();
                } else {
                    // Only show buttons if settings is closed
                    this.updateButtonLocations();
                }
            })
        );

        // Register other events
        this.registerEvent(
            this.app.workspace.on('resize', () => {
                if (!this.isSettingsOpen()) {
                    this.updateAllFloatingButtonPositions();
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                if (!this.isSettingsOpen()) {
                    this.updateAllFloatingButtonPositions();
                }
            })
        );
    }

    /**
     * Check if settings tab is currently open
     */
    isSettingsOpen(): boolean {
        // Check all leaves for settings views
        const allLeaves = this.app.workspace.getLeavesOfType('markdown')
            .concat(this.app.workspace.getLeavesOfType('empty'));
            
        for (const leaf of allLeaves) {
            const viewType = leaf.view?.getViewType();
            if (viewType === 'setting') {
                return true;
            }
        }
        return false;
    }

    /**
     * Updates button locations based on settings
     */
    updateButtonLocations() {
        // Clean up existing buttons first
        this.hideFloatingButtons();
        if (this.floatingCopyContainer) {
            this.floatingCopyContainer.remove();
            this.floatingCopyContainer = null;
        }
        if (this.floatingSaveContainer) {
            this.floatingSaveContainer.remove();
            this.floatingSaveContainer = null;
        }
        if (this.floatingButtonsContainer) {
            this.floatingButtonsContainer.remove();
            this.floatingButtonsContainer = null;
        }
        
        // Additional cleanup
        document.querySelectorAll('.editor-to-clipboard-floating-container').forEach(el => el.remove());
        
        // Don't create new buttons if settings is open
        if (this.isSettingsOpen()) {
            return;
        }
        
        // Check if we need to create floating buttons
        if (this.settings.copyButtonPosition.startsWith('floating-') || 
            this.settings.saveButtonPosition.startsWith('floating-')) {
            
            // Check if both buttons are in the same position
            if (this.settings.copyButtonPosition === this.settings.saveButtonPosition && 
                this.settings.copyButtonPosition.startsWith('floating-')) {
                this.createFloatingButtonGroup(this.settings.copyButtonPosition);
            } else {
                if (this.settings.copyButtonPosition.startsWith('floating-')) {
                    this.createFloatingButton('copy', this.settings.copyButtonPosition);
                }
                if (this.settings.saveButtonPosition.startsWith('floating-')) {
                    this.createFloatingButton('save', this.settings.saveButtonPosition);
                }
            }
        }
        
        this.addButtonsToContainers();
    }

    /**
     * Hides floating buttons when settings screen is open
     */
    hideFloatingButtons() {
        if (this.floatingCopyContainer) {
            this.floatingCopyContainer.style.display = 'none';
        }
        if (this.floatingSaveContainer) {
            this.floatingSaveContainer.style.display = 'none';
        }
    }

    /**
     * Shows floating buttons when settings screen is closed
     */
    showFloatingButtons() {
        if (this.floatingCopyContainer) {
            this.floatingCopyContainer.style.display = 'flex';
        }
        if (this.floatingSaveContainer) {
            this.floatingSaveContainer.style.display = 'flex';
        }
    }

    /**
     * Creates the top-of-note container
     */
    createTopOfNoteContainer() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;
        
        // Find the header element instead of using contentEl
        const headerEl = activeView.containerEl.querySelector('.view-header');
        if (!headerEl) return;
        
        // Create container for buttons
        this.topOfNoteButtonsContainer = headerEl.createEl('div', {
            cls: 'editor-to-clipboard-top-note-container'
        });
        
        // Add styles for proper positioning in header
        this.topOfNoteButtonsContainer.style.display = 'flex';
        this.topOfNoteButtonsContainer.style.alignItems = 'center';
        this.topOfNoteButtonsContainer.style.marginLeft = 'auto'; // Push to right side of header
        
        // Register event handler to add buttons to new active views
        this.leafChangeEvent = this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                // Remove old container
                if (this.topOfNoteButtonsContainer) {
                    this.topOfNoteButtonsContainer.remove();
                    this.topOfNoteButtonsContainer = null;
                }
                
                // Also clean up any other instances that might exist
                document.querySelectorAll('.editor-to-clipboard-top-note-container').forEach(el => el.remove());
                
                // Create new container in the active view if it's a markdown view
                const newActiveView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (newActiveView) {
                    const headerEl = newActiveView.containerEl.querySelector('.view-header');
                    if (!headerEl) return;
                    this.topOfNoteButtonsContainer = headerEl.createEl('div', {
                        cls: 'editor-to-clipboard-top-note-container'
                    });
                    this.topOfNoteButtonsContainer.style.display = 'flex';
                    this.topOfNoteButtonsContainer.style.alignItems = 'center';
                    this.topOfNoteButtonsContainer.style.marginLeft = 'auto';
                    this.addButtonsToContainers();
                }
            })
        );
    }
    
    /**
     * Creates a floating button container with the appropriate position
     */
    createFloatingButton(type: 'copy' | 'save', position: string) {
        // Create the container
        const container = document.body.createEl('div', {
            cls: `editor-to-clipboard-floating-container editor-to-clipboard-${type}-container`
        });
        
        // Extract position parameters from the setting
        // Format is floating-[left/right]-[top/middle/bottom]
        const [_, horizontal, vertical] = position.split('-');
        
        // Get the workspace leaf to position relative to the editor area
        const workspaceLeaf = document.querySelector('.workspace-leaf.mod-active .view-content');
        
        // Apply horizontal positioning - relative to editor content
        if (workspaceLeaf) {
            const workspaceRect = workspaceLeaf.getBoundingClientRect();
            
            if (horizontal === 'left') {
                const leftOffset = Math.max(workspaceRect.left + 20, 60);
                container.style.left = leftOffset + 'px';
                container.style.right = 'auto';
            } else {
                const rightOffset = Math.max(document.body.clientWidth - workspaceRect.right + 20, 60);
                container.style.right = rightOffset + 'px';
                container.style.left = 'auto';
            }
            
            // Apply vertical positioning
            switch (vertical) {
                case 'top':
                    container.style.top = (workspaceRect.top + 80) + 'px'; // Adjusted to match group positioning
                    container.style.bottom = 'auto';
                    container.style.transform = 'none';
                    break;
                case 'middle':
                    container.style.top = (workspaceRect.top + workspaceRect.height / 2) + 'px';
                    container.style.bottom = 'auto';
                    container.style.transform = 'translateY(-50%)';
                    break;
                case 'bottom':
                    container.style.bottom = (document.body.clientHeight - workspaceRect.bottom + 20) + 'px';
                    container.style.top = 'auto';
                    container.style.transform = 'none';
                    break;
            }
        } else {
            // Fallback to original positioning if workspace leaf not found
            if (horizontal === 'left') {
                container.style.left = '60px';
                container.style.right = 'auto';
            } else {
                container.style.right = '60px';
                container.style.left = 'auto';
            }
            
            switch (vertical) {
                case 'top':
                    container.style.top = '80px';
                    container.style.bottom = 'auto';
                    container.style.transform = 'none';
                    break;
                case 'middle':
                    container.style.top = '50%';
                    container.style.bottom = 'auto';
                    container.style.transform = 'translateY(-50%)';
                    break;
                case 'bottom':
                    container.style.bottom = '80px';
                    container.style.top = 'auto';
                    container.style.transform = 'none';
                    break;
            }
        }
        
        // Add to DOM
        document.body.appendChild(container);
        
        // Store reference to the container
        if (type === 'copy') {
            this.floatingCopyContainer = container;
        } else {
            this.floatingSaveContainer = container;
        }
        
        // Add the button to this container
        this.addButtonToContainer(type, container);
        
        // Register event for workspace resize to update button positions
        this.registerEvent(
            this.app.workspace.on('resize', () => {
                this.updateFloatingButtonPosition(container, type, position);
            })
        );
        
        // Also update when active leaf changes
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.updateFloatingButtonPosition(container, type, position);
            })
        );
        
        return container;
    }
    
    /**
     * Updates the position of floating buttons when workspace changes
     */
    updateFloatingButtonPosition(container: HTMLElement, type: 'copy' | 'save', position: string) {
        if (!container) return;
        
        // Extract position parameters
        const [_, horizontal, vertical] = position.split('-');
        
        // Get the main content area (excluding sidebars)
        const mainContent = document.querySelector('.workspace-split.mod-vertical.mod-root');
        if (!mainContent) return;
        
        // Get the active editor content area
        const workspaceLeaf = document.querySelector('.workspace-leaf.mod-active .view-content');
        if (!workspaceLeaf) return;
        
        const mainContentRect = mainContent.getBoundingClientRect();
        const workspaceRect = workspaceLeaf.getBoundingClientRect();
        
        // Update horizontal position relative to main content area
        if (horizontal === 'left') {
            const leftOffset = Math.max(workspaceRect.left + 20, mainContentRect.left + 60);
            container.style.left = leftOffset + 'px';
            container.style.right = 'auto';
        } else {
            const rightOffset = Math.max(
                document.body.clientWidth - workspaceRect.right + 20,
                document.body.clientWidth - mainContentRect.right + 60
            );
            container.style.right = rightOffset + 'px';
            container.style.left = 'auto';
        }
        
        // Update vertical position
        switch (vertical) {
            case 'top':
                container.style.top = (workspaceRect.top + 20) + 'px';
                container.style.bottom = 'auto';
                container.style.transform = 'none';
                break;
            case 'middle':
                container.style.top = (workspaceRect.top + workspaceRect.height / 2) + 'px';
                container.style.bottom = 'auto';
                container.style.transform = 'translateY(-50%)';
                break;
            case 'bottom':
                container.style.bottom = (document.body.clientHeight - workspaceRect.bottom + 20) + 'px';
                container.style.top = 'auto';
                container.style.transform = 'none';
                break;
        }
    }

    /**
     * Creates a grouped button container when both buttons are in the same position
     */
    createFloatingButtonGroup(position: string) {
        // Create the container
        const container = document.body.createEl('div', {
            cls: 'editor-to-clipboard-floating-container editor-to-clipboard-group-container'
        });
        
        // Get the main content area (excluding sidebars)
        const mainContent = document.querySelector('.workspace-split.mod-vertical.mod-root');
        if (!mainContent) return container;
        
        const mainContentRect = mainContent.getBoundingClientRect();
        
        // Extract position parameters from the setting
        const [_, horizontal, vertical] = position.split('-');
        
        // Apply initial positioning relative to main content
        if (horizontal === 'left') {
            container.style.left = (mainContentRect.left + 60) + 'px';
            container.style.right = 'auto';
        } else {
            container.style.right = (document.body.clientWidth - mainContentRect.right + 60) + 'px';
            container.style.left = 'auto';
        }
        
        // Apply vertical positioning
        switch (vertical) {
            case 'top':
                container.style.top = (mainContentRect.top + 80) + 'px'; // Adjusted to match single button height
                container.style.bottom = 'auto';
                container.style.transform = 'none';
                break;
            case 'middle':
                container.style.top = (mainContentRect.top + mainContentRect.height / 2) + 'px';
                container.style.bottom = 'auto';
                container.style.transform = 'translateY(-50%)';
                break;
            case 'bottom':
                container.style.bottom = (document.body.clientHeight - mainContentRect.bottom + 20) + 'px';
                container.style.top = 'auto';
                container.style.transform = 'none';
                break;
        }
        
        // Set container to use flexbox - horizontal for top positions, vertical otherwise
        container.style.display = 'flex';
        
        // Arrange buttons horizontally for top positions, vertically otherwise
        if (vertical === 'top') {
            container.style.flexDirection = 'row';
            container.style.gap = '15px'; // Slightly more spacing for horizontal layout
        } else {
            container.style.flexDirection = 'column';
            container.style.gap = '10px'; // Original spacing for vertical layout
        }
        
        // Add to DOM
        document.body.appendChild(container);
        
        // Store references to both containers
        this.floatingCopyContainer = container;
        this.floatingSaveContainer = container;
        this.floatingButtonsContainer = container;
        
        // Add both buttons to this container
        this.addButtonToContainer('copy', container);
        this.addButtonToContainer('save', container);
        
        return container;
    }

    /**
     * Add a specific button to a container
     */
    addButtonToContainer(type: 'copy' | 'save', container: HTMLElement) {
        let buttonEl: HTMLElement;
        
        if (type === 'copy') {
            buttonEl = container.createEl('div', {
                cls: 'editor-to-clipboard-button',
                attr: { 'aria-label': 'Copy Markdown Content' }
            });
            
            const icon = buttonEl.createEl('span', { 
                cls: 'clipboard-icon', 
                text: '📋' 
            });
            
            buttonEl.addEventListener('click', () => {
                this.OneClickClipboard();
                // Visual feedback on click
                buttonEl.classList.add('is-active');
                setTimeout(() => {
                    buttonEl.classList.remove('is-active');
                }, 200);
            });
            
            this.clipboardButtonEl = buttonEl;
        } else {
            buttonEl = container.createEl('div', {
                cls: 'editor-to-clipboard-button',
                attr: { 'aria-label': 'Save Markdown Content to File' }
            });
            
            const icon = buttonEl.createEl('span', { 
                cls: 'save-icon', 
                text: '💾' 
            });
            
            buttonEl.addEventListener('click', () => {
                this.saveToFile();
            });
            
            this.saveButtonEl = buttonEl;
        }
        
        return buttonEl;
    }

    /**
     * Add buttons to the appropriate containers based on settings
     */
    addButtonsToContainers() {
        // Add copy button
        this.addButtonForPosition('copy', this.settings.copyButtonPosition);
        
        // Add save button
        this.addButtonForPosition('save', this.settings.saveButtonPosition);
    }
    
    /**
     * Add a button based on its position setting
     */
    addButtonForPosition(type: 'copy' | 'save', position: string) {
        if (position === 'hidden') return;
        
        if (position === 'ribbon') {
            // Add to ribbon
            const buttonEl = this.addRibbonIcon(
                type === 'copy' ? 'clipboard' : 'save', 
                type === 'copy' ? 'Copy Markdown Content' : 'Save Markdown Content to File', 
                () => {
                    type === 'copy' ? this.OneClickClipboard() : this.saveToFile();
                }
            );
            
            buttonEl.addClass(type === 'copy' ? 'editor-to-clipboard-plugin' : 'editor-to-clipboard-save-plugin');
            buttonEl.addClass('editor-to-clipboard-ribbon-button');
            
            if (type === 'copy') {
                this.clipboardButtonEl = buttonEl;
            } else {
                this.saveButtonEl = buttonEl;
            }
        }
        // Floating buttons are handled by createFloatingButton
    }

    /**
     * Copies the raw markdown content from the editor.
     * (Optionally, you can add logic here to resolve block references by parsing the markdown and fetching the referenced text.)
     */
    async OneClickClipboard() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            new Notice("No active markdown view found.");
            return;
        }
        const editor = activeView.editor;
        let content = editor.getValue();

        // Remove metadata if the setting is enabled
        if (this.settings.removeMetadata) {
            content = content.replace(/^---\n[\s\S]*?\n---\n/, '');
        }

        // Remove block IDs if the setting is enabled
        if (this.settings.removeBlockIds) {
            content = this.cleanAllBlockIds(content);
        }

        // Process block references
        content = await this.resolveBlockReferences(content);

        await navigator.clipboard.writeText(content);
        new Notice("Copied markdown content to clipboard!");
    }

    /**
     * Saves the processed markdown content to a file
     */
    async saveToFile() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            new Notice("No active markdown view found.");
            return;
        }
        const editor = activeView.editor;
        let content = editor.getValue();

        // Remove metadata if the setting is enabled
        if (this.settings.removeMetadata) {
            content = content.replace(/^---\n[\s\S]*?\n---\n/, '');
        }

        // Remove block IDs if the setting is enabled
        if (this.settings.removeBlockIds) {
            content = this.cleanAllBlockIds(content);
        }

        // Process block references
        content = await this.resolveBlockReferences(content);

        // Get current file name as a suggestion
        const currentFile = activeView.file;
        const fileName = currentFile ? currentFile.name.replace('.md', '') : 'exported-content';
        // Apply prefix to file name
        let suggestedName = `${this.settings.fileNamePrefix}${fileName}.md`;

        // If default save location is set, use it
        let targetPath = this.settings.defaultSaveLocation;
        
        // If no default path or it's empty, prompt the user
        if (!targetPath) {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = suggestedName;
            
            // Create a promise to handle the modal response
            const savePathPromise = new Promise<string>((resolve) => {
                const modal = new SaveFileModal(this.app, input, (result) => {
                    resolve(result);
                });
                modal.open();
            });
            
            targetPath = await savePathPromise;
            
            // If user cancelled, abort
            if (!targetPath) {
                return;
            }
            
            // Ensure .md extension
            if (!targetPath.endsWith('.md')) {
                targetPath += '.md';
            }
        }
        
        try {
            // Check if the file already exists
            const existingFile = this.app.vault.getAbstractFileByPath(targetPath);
            
            if (existingFile instanceof TFile) {
                // File exists, ask for confirmation
                const confirmPromise = new Promise<boolean>((resolve) => {
                    const modal = new ConfirmationModal(
                        this.app,
                        `The file "${targetPath}" already exists. Do you want to overwrite it?`,
                        (confirmed) => {
                            resolve(confirmed);
                        }
                    );
                    modal.open();
                });
                
                const shouldOverwrite = await confirmPromise;
                if (!shouldOverwrite) {
                    // User declined to overwrite, abort
                    return;
                }
            }
            
            // Create or overwrite the file
            await this.app.vault.create(targetPath, content);
            new Notice(`Content saved to ${targetPath}`);
            
            // Open the saved file if the setting is enabled
            if (this.settings.openNewFile) {
                const savedFile = this.app.vault.getAbstractFileByPath(targetPath);
                if (savedFile && savedFile instanceof TFile) {
                    // Open the file in a new leaf (tab)
                    await this.app.workspace.getLeaf('tab').openFile(savedFile);
                }
            }
        } catch (error) {
            console.error('Failed to save file:', error);
            new Notice('Failed to save file. Check console for details.');
        }
    }

    async resolveBlockReferences(content: string): Promise<string> {
        const embedPattern = /\!\[\[(.*?)(?:#([^\]]+))?\]\]/g;
        let matches = Array.from(content.matchAll(embedPattern));
        
        for (let i = matches.length - 1; i >= 0; i--) {
            const match = matches[i];
            if (!match || !match.index) continue;  // Skip if match or index is undefined
            
            const fullMatch = match[0];
            const filePath = match[1].trim();
            const hashPart = match[2] ? match[2].trim() : "";
            
            const targetFile = this.app.metadataCache.getFirstLinkpathDest(filePath, "");
            if (!targetFile) {
                content = content.slice(0, match.index) + 
                    `[File not found: ${filePath}]` + 
                    content.slice(match.index + fullMatch.length);
                continue;
            }
            
            const fileContent = await this.app.vault.read(targetFile);
            const fileCache = this.app.metadataCache.getFileCache(targetFile);
            
            let replacement: string | null = null;
            
            if (hashPart.startsWith("^")) {
                const blockId = hashPart.slice(1);
                
                if (fileCache && fileCache.blocks && fileCache.blocks[blockId]) {
                    const blockPosition = fileCache.blocks[blockId].position;
                    const fileLines = fileContent.split('\n');
                    replacement = fileLines[blockPosition.start.line];
                    replacement = this.cleanBlockContent(replacement, blockId);
                } else {
                    const blockPattern = new RegExp(`(.*?)\\s*\\^${blockId}(?:\\s|$)`, "m");
                    const blockMatch = blockPattern.exec(fileContent);
                    replacement = blockMatch ? blockMatch[1].trim() : null;
                    
                    if (!replacement) {
                        const lines = fileContent.split('\n');
                        for (const line of lines) {
                            if (line.includes(`^${blockId}`)) {
                                replacement = this.cleanBlockContent(line, blockId);
                                break;
                            }
                        }
                    }
                }
            } else if (hashPart) {
                if (fileCache && fileCache.headings) {
                    const heading = fileCache.headings.find(h => 
                        h.heading.toLowerCase() === hashPart.toLowerCase());
                    
                    if (heading) {
                        const headingLevel = heading.level;
                        const headingLine = heading.position.start.line;
                        const fileLines = fileContent.split('\n');
                        let endLine = fileLines.length;
                        
                        for (let lineNum = headingLine + 1; lineNum < fileLines.length; lineNum++) {
                            const line = fileLines[lineNum];
                            const headingMatch = line.match(/^(#{1,6})\s/);
                            if (headingMatch && headingMatch[1].length <= headingLevel) {
                                endLine = lineNum;
                                break;
                            }
                        }
                        
                        replacement = fileLines.slice(headingLine, endLine).join('\n').trim();
                    }
                }
                
                if (!replacement) {
                    replacement = await this.getHeadingContent(filePath, hashPart);
                }
            } else {
                replacement = fileContent;
            }
            
            if (replacement) {
                const beforeEmbed = match.index > 0 ? content[match.index - 1] : '';
                const afterEmbed = match.index + fullMatch.length < content.length ? 
                    content[match.index + fullMatch.length] : '';
                
                const preserveLeadingNewline = beforeEmbed === '\n' ? '\n' : '';
                const preserveTrailingNewline = afterEmbed === '\n' ? '\n' : '';
                
                content = content.slice(0, match.index) + 
                    preserveLeadingNewline + replacement + preserveTrailingNewline + 
                    content.slice(match.index + fullMatch.length);
            } else {
                content = content.slice(0, match.index) + 
                    `[Content not found: ${filePath}${hashPart ? '#' + hashPart : ''}]` + 
                    content.slice(match.index + fullMatch.length);
            }
        }
        
        return content;
    }

    /**
     * Helper function to clean block content by removing block IDs
     * @param content The block content that may contain a block ID
     * @param blockId The specific blockId to remove (optional)
     * @returns Cleaned content without block IDs
     */
    cleanBlockContent(content: string, blockId?: string): string {
        if (!content) return "";
        
        // First try to remove the specific block ID if provided
        if (blockId) {
            content = content.replace(new RegExp(`\\^${blockId}\\s*$`), '');
        }
        
        // Also remove any other block IDs that might be present
        content = content.replace(/\s*\^[a-zA-Z0-9]+\s*$/g, '');
        
        return content.trim();
    }

    /**
     * Clean all block IDs from content
     */
    cleanAllBlockIds(content: string): string {
        // Split into lines to process each line
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            // Apply block ID cleaning to each line
            lines[i] = this.cleanBlockContent(lines[i]);
        }
        
        return lines.join('\n');
    }

    // Fetch the entire file content if it's just ![[someFile]] with no # part
    async getFullFileContent(filePath: string): Promise<string | null> {
        const file = this.app.metadataCache.getFirstLinkpathDest(filePath, "");
        if (!file) return null;
        return await this.app.vault.read(file);
    }

    // Capture only the specified block
    async getBlockContent(filePath: string, blockId: string): Promise<string | null> {
        const file = this.app.metadataCache.getFirstLinkpathDest(filePath, "");
        if (!file) return null;
        const fileContent = await this.app.vault.read(file);

        // In Obsidian, block IDs are typically at the end of a line like: "Some text ^blockId"
        // Match any line that contains the block ID
        const blockPattern = new RegExp(`.*\\^${blockId}.*$`, "m");
        const match = blockPattern.exec(fileContent);
        
        if (!match) return null;
        
        // Return the line content without the block ID using our cleaning function
        return this.cleanBlockContent(match[0], blockId);
    }

    // Capture heading from matching heading line until the next heading of equal/higher level
    async getHeadingContent(filePath: string, heading: string): Promise<string | null> {
        const file = this.app.metadataCache.getFirstLinkpathDest(filePath, "");
        if (!file) return null;
        const fileContent = await this.app.vault.read(file);

        // Escape special regex characters in heading text
        const safeHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        // First, determine the level of the heading (number of #)
        const headingLevelPattern = new RegExp(`^(#{1,6})\\s+${safeHeading}`, "m");
        const levelMatch = headingLevelPattern.exec(fileContent);
        if (!levelMatch) return null;
        
        const headingLevel = levelMatch[1].length;

        // Match the heading line and capture until the next heading of same/higher level or EOF
        const headingPattern = new RegExp(
            `^#{${headingLevel}}\\s+${safeHeading}.*?$(\\n[\\s\\S]*?)(?=^#{1,${headingLevel}}\\s|$)`,
            "m"
        );
        
        const match = headingPattern.exec(fileContent);
        return match ? match[1].trim() : null;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        // Clean up all button elements when plugin is disabled
        document.querySelectorAll('.editor-to-clipboard-floating-container').forEach(el => el.remove());
        
        // Unregister event if exists
        if (this.leafChangeEvent) {
            this.app.workspace.offref(this.leafChangeEvent);
            this.leafChangeEvent = null;
        }
    }

    /**
     * Updates positions of all floating buttons with debouncing
     */
    updateAllFloatingButtonPositions() {
        // Don't update if settings tab is open
        const activeLeaf = this.app.workspace.activeLeaf;
        if (activeLeaf?.view instanceof SettingTab) {
            return;
        }

        // Clear any existing timeout
        if (this.positionUpdateTimeout) {
            clearTimeout(this.positionUpdateTimeout);
        }

        // Debounce position updates to prevent flickering
        this.positionUpdateTimeout = setTimeout(() => {
            if (this.floatingCopyContainer) {
                this.updateFloatingButtonPosition(
                    this.floatingCopyContainer,
                    'copy',
                    this.settings.copyButtonPosition
                );
            }
            if (this.floatingSaveContainer && this.floatingSaveContainer !== this.floatingCopyContainer) {
                this.updateFloatingButtonPosition(
                    this.floatingSaveContainer,
                    'save',
                    this.settings.saveButtonPosition
                );
            }
            this.positionUpdateTimeout = null;
        }, 50); // Small delay to batch position updates
    }
}

// Custom modal for getting save file path
class SaveFileModal extends Modal {
    result: string;
    inputEl: HTMLInputElement;
    onSubmit: (result: string) => void;

    constructor(app: App, inputEl: HTMLInputElement, onSubmit: (result: string) => void) {
        super(app);
        this.inputEl = inputEl;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        
        contentEl.createEl('h2', { text: 'Save to file' });
        
        contentEl.createEl('p', { 
            text: 'Enter the file path where you want to save the content:'
        });
        
        // Add the input element
        contentEl.appendChild(this.inputEl);
        this.inputEl.style.width = '100%';
        this.inputEl.focus();
        
        // Add action buttons
        const buttonContainer = contentEl.createEl('div');
        buttonContainer.style.marginTop = '1rem';
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        
        const saveButton = buttonContainer.createEl('button', { text: 'Save' });
        saveButton.addEventListener('click', () => {
            this.close();
            this.onSubmit(this.inputEl.value);
        });
        
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.style.marginRight = '0.5rem';
        cancelButton.addEventListener('click', () => {
            this.close();
            this.onSubmit('');
        });
        
        // Handle Enter key
        this.inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.close();
                this.onSubmit(this.inputEl.value);
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Custom modal for confirming file overwrite
class ConfirmationModal extends Modal {
    message: string;
    onConfirm: (confirmed: boolean) => void;

    constructor(app: App, message: string, onConfirm: (confirmed: boolean) => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        
        contentEl.createEl('h2', { text: 'Confirmation' });
        
        contentEl.createEl('p', { 
            text: this.message
        });
        
        // Add action buttons
        const buttonContainer = contentEl.createEl('div');
        buttonContainer.style.marginTop = '1rem';
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        
        const confirmButton = buttonContainer.createEl('button', { text: 'Overwrite' });
        confirmButton.addEventListener('click', () => {
            this.close();
            this.onConfirm(true);
        });
        
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.style.marginRight = '0.5rem';
        cancelButton.addEventListener('click', () => {
            this.close();
            this.onConfirm(false);
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class EditorToClipboardSettingTab extends PluginSettingTab {
    plugin: EditorToClipboardPlugin;

    constructor(app: App, plugin: EditorToClipboardPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Editor to Clipboard Plugin Settings' });

        // Content settings
        containerEl.createEl('h3', { text: 'Content Settings' });

        new Setting(containerEl)
            .setName('Remove Metadata')
            .setDesc('Remove metadata (front matter) from the copied content.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.removeMetadata)
                .onChange(async (value) => {
                    this.plugin.settings.removeMetadata = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Remove Block IDs')
            .setDesc('Remove block reference IDs from the copied content.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.removeBlockIds)
                .onChange(async (value) => {
                    this.plugin.settings.removeBlockIds = value;
                    await this.plugin.saveSettings();
                }));

        // Button settings
        containerEl.createEl('h3', { text: 'Button Settings' });

        new Setting(containerEl)
            .setName('Copy Button Position')
            .setDesc('Choose where to display the copy button.')
            .addDropdown(dropdown => dropdown
                .addOption('ribbon', 'Left Sidebar')
                .addOption('hidden', 'Hidden')
                .addOption('floating-left-top', 'Floating (Left Top)')
                .addOption('floating-left-middle', 'Floating (Left Middle)')
                .addOption('floating-left-bottom', 'Floating (Left Bottom)')
                .addOption('floating-right-top', 'Floating (Right Top)')
                .addOption('floating-right-middle', 'Floating (Right Middle)')
                .addOption('floating-right-bottom', 'Floating (Right Bottom)')
                .setValue(this.plugin.settings.copyButtonPosition)
                .onChange(async (value) => {
                    this.plugin.settings.copyButtonPosition = value as any;
                    await this.plugin.saveSettings();
                    this.plugin.updateButtonLocations();
                }));

        new Setting(containerEl)
            .setName('Save Button Position')
            .setDesc('Choose where to display the save button.')
            .addDropdown(dropdown => dropdown
                .addOption('ribbon', 'Left Sidebar')
                .addOption('hidden', 'Hidden')
                .addOption('floating-left-top', 'Floating (Left Top)')
                .addOption('floating-left-middle', 'Floating (Left Middle)')
                .addOption('floating-left-bottom', 'Floating (Left Bottom)')
                .addOption('floating-right-top', 'Floating (Right Top)')
                .addOption('floating-right-middle', 'Floating (Right Middle)')
                .addOption('floating-right-bottom', 'Floating (Right Bottom)')
                .setValue(this.plugin.settings.saveButtonPosition)
                .onChange(async (value) => {
                    this.plugin.settings.saveButtonPosition = value as any;
                    await this.plugin.saveSettings();
                    this.plugin.updateButtonLocations();
                }));

        // File settings
        containerEl.createEl('h3', { text: 'File Settings' });

        new Setting(containerEl)
            .setName('File Name Prefix')
            .setDesc('Prefix to add to exported file names.')
            .addText(text => text
                .setPlaceholder('(Plain) ')
                .setValue(this.plugin.settings.fileNamePrefix)
                .onChange(async (value) => {
                    this.plugin.settings.fileNamePrefix = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Save Location')
            .setDesc('Set a default save location for files. Leave empty to be prompted each time.')
            .addText(text => text
                .setPlaceholder('exports/')
                .setValue(this.plugin.settings.defaultSaveLocation)
                .onChange(async (value) => {
                    this.plugin.settings.defaultSaveLocation = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Open After Saving')
            .setDesc('Automatically open newly saved files in Obsidian.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.openNewFile)
                .onChange(async (value) => {
                    this.plugin.settings.openNewFile = value;
                    await this.plugin.saveSettings();
                }));
    }
}
