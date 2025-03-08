import { App, Plugin, PluginSettingTab, Setting, MarkdownView, Notice, Modal } from 'obsidian';

interface EditorToClipboardSettings {
    removeMetadata: boolean;
    showCopyButton: boolean;
    copyButtonLocation: 'ribbon' | 'statusbar' | 'hidden';
    showSaveButton: boolean;
    saveButtonLocation: 'ribbon' | 'statusbar' | 'hidden';
    defaultSaveLocation: string;
    fileNamePrefix: string;
}

const DEFAULT_SETTINGS: EditorToClipboardSettings = {
    removeMetadata: true,
    showCopyButton: true,
    copyButtonLocation: 'ribbon',
    showSaveButton: true,
    saveButtonLocation: 'ribbon',
    defaultSaveLocation: "", // Empty means user will be prompted
    fileNamePrefix: "(Plain) "
}

export default class EditorToClipboardPlugin extends Plugin {
    settings: EditorToClipboardSettings;
    saveButtonEl: HTMLElement | null = null;
    clipboardButtonEl: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();
        console.log('Loading Editor to Clipboard Plugin');

        // Command with a hotkey (Cmd/Ctrl+Shift+C)
        this.addCommand({
            id: 'copy-active-editor-content',
            name: 'Copy active editor content to clipboard',
            callback: () => {
                this.OneClickClipboard();
            },
            hotkeys: [
                {
                    modifiers: ["Mod", "Shift"],
                    key: "C"
                }
            ]
        });

        // Command with a hotkey (Cmd/Ctrl+Shift+S) for saving to a file
        this.addCommand({
            id: 'save-active-editor-content',
            name: 'Save active editor content to a file',
            callback: () => {
                this.saveToFile();
            },
            hotkeys: [
                {
                    modifiers: ["Mod", "Shift"],
                    key: "S"
                }
            ]
        });

        // Add buttons based on settings
        this.updateButtonLocations();

        // Add settings tab
        this.addSettingTab(new EditorToClipboardSettingTab(this.app, this));
    }

    /**
     * Updates button locations based on settings
     */
    updateButtonLocations() {
        // Clear any existing buttons
        if (this.saveButtonEl) {
            this.saveButtonEl.remove();
            this.saveButtonEl = null;
        }
        
        if (this.clipboardButtonEl) {
            this.clipboardButtonEl.remove();
            this.clipboardButtonEl = null;
        }
        
        // Add copy button if enabled
        if (this.settings.showCopyButton && this.settings.copyButtonLocation !== 'hidden') {
            if (this.settings.copyButtonLocation === 'ribbon') {
                // Add to ribbon
                this.clipboardButtonEl = this.addRibbonIcon('clipboard', 'Copy Markdown Content', () => {
                    this.OneClickClipboard();
                });
                this.clipboardButtonEl.addClass('editor-to-clipboard-plugin');
            } 
            else if (this.settings.copyButtonLocation === 'statusbar') {
                // Add to status bar
                this.clipboardButtonEl = this.addStatusBarItem();
                const clipboardIcon = this.clipboardButtonEl.createEl("span", { 
                    text: "📋",
                    attr: { 'aria-label': 'Copy Markdown Content' }
                });
                clipboardIcon.style.cursor = 'pointer';
                clipboardIcon.addEventListener('click', () => {
                    this.OneClickClipboard();
                });
            }
        }
        
        // Add save button if enabled
        if (this.settings.showSaveButton && this.settings.saveButtonLocation !== 'hidden') {
            if (this.settings.saveButtonLocation === 'ribbon') {
                // Add to ribbon
                this.saveButtonEl = this.addRibbonIcon('save', 'Save Markdown Content to File', () => {
                    this.saveToFile();
                });
                this.saveButtonEl.addClass('editor-to-clipboard-save-plugin');
            }
            else if (this.settings.saveButtonLocation === 'statusbar') {
                // Add to status bar
                this.saveButtonEl = this.addStatusBarItem();
                const saveIcon = this.saveButtonEl.createEl("span", { 
                    text: "💾",
                    attr: { 'aria-label': 'Save Markdown Content to File' }
                });
                saveIcon.style.cursor = 'pointer';
                saveIcon.addEventListener('click', () => {
                    this.saveToFile();
                });
            }
        }
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
            // Create or overwrite the file
            await this.app.vault.create(targetPath, content);
            new Notice(`Content saved to ${targetPath}`);
        } catch (error) {
            console.error('Failed to save file:', error);
            new Notice('Failed to save file. Check console for details.');
        }
    }

    async resolveBlockReferences(content: string): Promise<string> {
        // Pattern to match ![[file]], ![[file#heading]], or ![[file#^blockId]]
        const embedPattern = /\!\[\[(.*?)(?:#([^\]]+))?\]\]/g;
        let matches = Array.from(content.matchAll(embedPattern));
        
        // Process in reverse order to avoid position shifts
        for (let i = matches.length - 1; i >= 0; i--) {
            const match = matches[i];
            const fullMatch = match[0];
            const filePath = match[1].trim();
            const hashPart = match[2] ? match[2].trim() : "";
            
            console.log(`Processing embed: file="${filePath}", hash="${hashPart}"`);
            
            // Get the target file
            const targetFile = this.app.metadataCache.getFirstLinkpathDest(filePath, "");
            if (!targetFile) {
                console.log(`File not found: "${filePath}"`);
                content = content.slice(0, match.index) + 
                          `[File not found: ${filePath}]` + 
                          content.slice(match.index + fullMatch.length);
                continue;
            }
            
            // Get file content
            const fileContent = await this.app.vault.read(targetFile);
            const fileCache = this.app.metadataCache.getFileCache(targetFile);
            
            let replacement: string | null = null;
            
            // Determine if it's a block reference
            if (hashPart.startsWith("^")) {
                // It's a block reference
                const blockId = hashPart.slice(1);
                console.log(`Found block reference: ^${blockId} in file ${targetFile.path}`);
                
                // Try to find the block in the cache
                if (fileCache && fileCache.blocks && fileCache.blocks[blockId]) {
                    console.log(`Block found in cache: ${blockId}`);
                    const blockPosition = fileCache.blocks[blockId].position;
                    const fileLines = fileContent.split('\n');
                    replacement = fileLines[blockPosition.start.line].replace(`^${blockId}`, '').trim();
                } else {
                    // Fallback to regex if cache doesn't have block info
                    console.log(`Block not in cache, using regex: ^${blockId}`);
                    const blockPattern = new RegExp(`(.*?)\\s*\\^${blockId}(?:\\s|$)`, "m");
                    const blockMatch = blockPattern.exec(fileContent);
                    replacement = blockMatch ? blockMatch[1].trim() : null;
                    
                    if (!replacement) {
                        // Try more aggressive pattern match
                        console.log(`Trying aggressive pattern match for block: ^${blockId}`);
                        const lines = fileContent.split('\n');
                        for (const line of lines) {
                            if (line.includes(`^${blockId}`)) {
                                replacement = line.replace(`^${blockId}`, '').trim();
                                break;
                            }
                        }
                    }
                }
                
                console.log(`Block reference ${blockId} resolved to: ${replacement}`);
            } else if (hashPart) {
                // It's a heading reference
                const headingText = hashPart;
                console.log(`Found heading reference: ${headingText} in file ${targetFile.path}`);
                
                if (fileCache && fileCache.headings) {
                    // Find the heading in the cache
                    const heading = fileCache.headings.find(h => 
                        h.heading.toLowerCase() === headingText.toLowerCase());
                    
                    if (heading) {
                        const headingLevel = heading.level;
                        const headingLine = heading.position.start.line;
                        
                        // Find the next heading of same or higher level
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
                        
                        // Extract content between heading and next heading (include the heading itself)
                        replacement = fileLines.slice(headingLine, endLine).join('\n').trim();
                    }
                }
                
                // Fallback to regex if cache doesn't work
                if (!replacement) {
                    replacement = await this.getHeadingContent(filePath, headingText);
                }
                
                console.log(`Heading reference ${headingText} resolved to: ${replacement?.substring(0, 50)}...`);
            } else {
                // It's a full file embed
                replacement = fileContent;
                console.log(`Full file embed ${filePath} resolved`);
            }
            
            // Replace the embed with the content or remove it if not found
            if (replacement) {
                // Check if the embed is on its own line
                const beforeEmbed = match.index > 0 ? content[match.index - 1] : '';
                const afterEmbed = match.index + fullMatch.length < content.length ? content[match.index + fullMatch.length] : '';
                
                // Preserve newlines before and after if they exist
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
        
        // Return the line content without the block ID
        return match[0].replace(new RegExp(`\\^${blockId}`), "").trim();
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

class EditorToClipboardSettingTab extends PluginSettingTab {
    plugin: EditorToClipboardPlugin;

    constructor(app: App, plugin: EditorToClipboardPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Settings for Editor to Clipboard Plugin' });

        // Content settings
        containerEl.createEl('h3', { text: 'Content Settings' });

        new Setting(containerEl)
            .setName('Remove Metadata')
            .setDesc('Remove metadata information (marked by three dashes at the top of the file) when copying markdown content. This includes any front matter such as dates, tags, etc.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.removeMetadata)
                .onChange(async (value) => {
                    this.plugin.settings.removeMetadata = value;
                    await this.plugin.saveSettings();
                }));

        // Copy button settings
        containerEl.createEl('h3', { text: 'Copy Button Settings' });
        
        new Setting(containerEl)
            .setName('Show Copy Button')
            .setDesc('Enable or disable the button for copying content to clipboard.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showCopyButton)
                .onChange(async (value) => {
                    this.plugin.settings.showCopyButton = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateButtonLocations();
                }));

        new Setting(containerEl)
            .setName('Copy Button Location')
            .setDesc('Choose where to display the copy button.')
            .addDropdown(dropdown => dropdown
                .addOption('ribbon', 'Left Sidebar (Ribbon)')
                .addOption('statusbar', 'Top Bar')
                .addOption('hidden', 'Hidden')
                .setValue(this.plugin.settings.copyButtonLocation)
                .onChange(async (value) => {
                    this.plugin.settings.copyButtonLocation = value as 'ribbon' | 'statusbar' | 'hidden';
                    await this.plugin.saveSettings();
                    this.plugin.updateButtonLocations();
                }));

        // Save button settings
        containerEl.createEl('h3', { text: 'Save Button Settings' });
        
        new Setting(containerEl)
            .setName('Show Save Button')
            .setDesc('Enable or disable the button for saving content to a file.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showSaveButton)
                .onChange(async (value) => {
                    this.plugin.settings.showSaveButton = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateButtonLocations();
                }));

        new Setting(containerEl)
            .setName('Save Button Location')
            .setDesc('Choose where to display the save button.')
            .addDropdown(dropdown => dropdown
                .addOption('ribbon', 'Left Sidebar (Ribbon)')
                .addOption('statusbar', 'Top Bar')
                .addOption('hidden', 'Hidden')
                .setValue(this.plugin.settings.saveButtonLocation)
                .onChange(async (value) => {
                    this.plugin.settings.saveButtonLocation = value as 'ribbon' | 'statusbar' | 'hidden';
                    await this.plugin.saveSettings();
                    this.plugin.updateButtonLocations();
                }));

        new Setting(containerEl)
            .setName('File Name Prefix')
            .setDesc('Prefix to add to exported file names (e.g., "(Plain) ")')
            .addText(text => text
                .setPlaceholder('(Plain) ')
                .setValue(this.plugin.settings.fileNamePrefix)
                .onChange(async (value) => {
                    this.plugin.settings.fileNamePrefix = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Save Location')
            .setDesc('Optional: Set a default save location for files. Leave empty to be prompted each time. Example: "exports/content.md"')
            .addText(text => text
                .setPlaceholder('exports/content.md')
                .setValue(this.plugin.settings.defaultSaveLocation)
                .onChange(async (value) => {
                    this.plugin.settings.defaultSaveLocation = value;
                    await this.plugin.saveSettings();
                }));
    }
}
