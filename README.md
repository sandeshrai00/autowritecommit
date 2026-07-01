# Auto Commit Message

Automatically generate conventional commit messages based on your git changes. Works completely offline without any AI APIs or cloud services.

## Features

- 🎯 **One-Click Generation**: Click the ✨ button in the Source Control panel
- 📝 **Conventional Commits**: Generates messages following [Conventional Commits](https://www.conventionalcommits.org/) standard
- 🔒 **100% Offline**: Works completely locally - no API calls, no data sent anywhere
- 🎨 **Smart Analysis**: Analyzes git diffs to determine the appropriate commit type
- 📊 **File-Aware**: Understands file types and directories to provide better context
- ⚙️ **Configurable**: Customize message format, length, emojis, and scopes

## Example Messages

- `feat: add login component`
- `fix: resolve null pointer in auth service`
- `docs: update README with setup instructions`
- `style: format CSS files with prettier`
- `refactor: simplify authentication logic`
- `test: add unit tests for user service`
- `chore: update dependencies`

## Usage

1. Make changes to your files
2. Stage the changes (optional - works with unstaged changes too)
3. Click the ✨ button in the Source Control panel's toolbar
4. Review the generated message
5. Commit manually

## Configuration

This extension contributes the following settings:

* `autoCommitMessage.useEmoji`: Include emoji in commit messages (default: `false`)
* `autoCommitMessage.maxLength`: Maximum length of commit message subject (default: `72`)
* `autoCommitMessage.includeScope`: Try to detect and include commit scope (default: `false`)

## Requirements

- Git must be installed and available in your PATH
- VS Code 1.85.0 or higher

## Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Auto Commit Message"
4. Click Install

### Manual Installation
1. Download the `.vsix` file
2. Run: `code --install-extension auto-commit-message-1.0.0.vsix`

## Building from Source

```bash
npm install
npm run compile