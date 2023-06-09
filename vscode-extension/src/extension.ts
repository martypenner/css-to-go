import { AutocompletionEngine } from '@css-to-go/autocompletion-engine';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXTENSION_NAME = 'css-to-go';
const FILES_LIST_KEY = 'filesList';
const HTML_LANGUAGES_KEY = 'htmlLanguages';
const JS_LANGUAGES_KEY = 'javascriptLanguages';

const config = vscode.workspace.getConfiguration;
const engine = new AutocompletionEngine();
let filesAndWatchers: FilesAndWatchers = getFilesToWatchAndParseFromConfig(config, engine);

// WARNING!!!
// Caching `vscode.workspace.getConfiguration()` in a variable means you get stale values.
// Always call it at the moment you need it instead.
export function activate(context: vscode.ExtensionContext) {
  if (vscode.workspace.workspaceFolders === undefined) {
    return;
  }

  const languages = getLanguagesFromConfig(config);

  context.subscriptions.push(
    vscode.commands.registerCommand(`${EXTENSION_NAME}.addCssFileToAutocomplete`, async (file) => {
      const newList = Array.from(new Set(getFilesToParseFromConfig(config).concat(file.path)));
      console.log(newList);

      config(EXTENSION_NAME)
        .update(FILES_LIST_KEY, newList, vscode.ConfigurationTarget.Global)
        .then(
          () => {},
          (error) => {
            vscode.window.showErrorMessage(
              `We couldn't update your configuration for some reason. Please see the debug logs for more info.`
            );
            console.error(
              `We couldn't update your configuration for the following reason: ${error}`
            );
          }
        );
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.removeCssFileFromAutocomplete`,
      async (file) => {
        const newList = Array.from(
          new Set(getFilesToParseFromConfig(config).filter((path) => path !== file.path))
        );
        console.log(newList);

        config(EXTENSION_NAME)
          .update(FILES_LIST_KEY, newList, vscode.ConfigurationTarget.Global)
          .then(
            () => {},
            (error) => {
              vscode.window.showErrorMessage(
                `We couldn't update your configuration for some reason. Please see the debug logs for more info.`
              );
              console.error(
                `We couldn't update your configuration for the following reason: ${error}`
              );
            }
          );
      }
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      cleanupFileWatchers(filesAndWatchers, engine);
      filesAndWatchers = getFilesToWatchAndParseFromConfig(config, engine);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(EXTENSION_NAME)) {
        return;
      }

      cleanupFileWatchers(filesAndWatchers, engine);
      filesAndWatchers = getFilesToWatchAndParseFromConfig(config, engine);
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      languages,
      {
        provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
          // Get the entire line text and search for `class=""`. We only want to
          // trigger completions inside of that and nowhere else. I really wish we
          // didn't have to resort to a regex, but setting up embedded languages
          // and / or an entire language server seemed like overkill. Maybe we
          // will be bitten by a massive bug or a regex DOS attack and have to
          // rethink this, but it works for now.
          const line = document.lineAt(position).text;
          const classRegex = /class(?:[nN](?:ame))?=["'](?<classList>[^"']*)/giu;
          const allMatches = line.matchAll(classRegex);
          const existingClassList = new Set();

          for (const match of allMatches) {
            // eslint-disable-next-line eqeqeq
            if (match.index == null) {
              continue;
            }

            const isWithinRange =
              position.character >= match.index &&
              position.character <= match.index + match[0].length;
            if (!isWithinRange) {
              return undefined;
            }

            const classList = match.groups?.classList.split(' ').filter(Boolean) ?? [];
            for (const className of classList) {
              existingClassList.add(className);
            }
          }

          try {
            const allCompletions: Completions = JSON.parse(
              engine.getAllCompletionsAsString(Array.from(filesAndWatchers.keys()))
            );
            const allowedCompletions = allCompletions.filter(
              ([className]) => !existingClassList.has(className)
            );
            const completions = allowedCompletions.map(([className, ruleSet]) => {
              const completion = new vscode.CompletionItem(
                className,
                vscode.CompletionItemKind.Constant
              );
              completion.documentation = new vscode.MarkdownString(
                ['```css', ruleSet, '```'].join('\n')
              );

              return completion;
            });

            return completions;
          } catch (error) {
            vscode.window.showErrorMessage(
              `Error parsing CSS completions from the autocompletion engine: ${error}`
            );
            console.error(`Error parsing CSS completions from the autocompletion engine: ${error}`);
          }
        },
      },
      "'",
      '"',
      ' '
    )
  );
}

export function deactivate() {
  cleanupFileWatchers(filesAndWatchers, engine);
}

function getLanguagesFromConfig(config: typeof vscode.workspace.getConfiguration) {
  let htmlLanguages = config(EXTENSION_NAME).get(HTML_LANGUAGES_KEY, []);
  if (!Array.isArray(htmlLanguages)) {
    vscode.window.showErrorMessage(
      `Found an invalid config value for ${HTML_LANGUAGES_KEY}. Expected an array of strings. Falling back to [].`
    );
    htmlLanguages = [];
  }
  let javascriptLanguages = config().get(`${EXTENSION_NAME}.${JS_LANGUAGES_KEY}`, []);
  if (!Array.isArray(javascriptLanguages)) {
    vscode.window.showErrorMessage(
      `Found an invalid config value for ${JS_LANGUAGES_KEY}. Expected an array of strings. Falling back to [].`
    );
    javascriptLanguages = [];
  }
  return htmlLanguages.concat(javascriptLanguages);
}

type ClassName = string;
type RuleSet = string;
type Completions = Array<[ClassName, RuleSet]>;

type FilesAndWatchers = Map<string, vscode.FileSystemWatcher>;

function cleanupFileWatchers(filesAndWatchers: FilesAndWatchers, engine: AutocompletionEngine) {
  for (const watcher of filesAndWatchers.values()) {
    watcher.dispose();
  }

  engine.invalidateCache();
}

function getFilesToWatchAndParseFromConfig(
  config: typeof vscode.workspace.getConfiguration,
  engine: AutocompletionEngine
): Map<string, vscode.FileSystemWatcher> {
  const files = getFilesToParseFromConfig(config);

  const filesAndWatchers = new Map(
    files.map((file) => {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(path.dirname(file), path.basename(file))
      );
      // This one gets fired when a file in our list does not exist until now.
      watcher.onDidCreate(() => {
        engine.invalidateCache();
      });
      watcher.onDidChange(() => {
        engine.invalidateCache();
      });
      watcher.onDidDelete(() => {
        watcher.dispose();
        engine.invalidateCache();
      });

      return [file, watcher];
    })
  );

  return filesAndWatchers;
}

function getFilesToParseFromConfig(config: typeof vscode.workspace.getConfiguration): string[] {
  config().get(`${EXTENSION_NAME}.${FILES_LIST_KEY}`);
  let files: string[] = (config(EXTENSION_NAME).get(FILES_LIST_KEY) ?? []) as string[];
  if (!Array.isArray(files)) {
    vscode.window.showErrorMessage(
      `Found an invalid config value for ${FILES_LIST_KEY}. Expected an array of strings. Falling back to [].`
    );
    files = [];
  }

  const workspaceFolderNames =
    vscode.workspace.workspaceFolders?.map((folder) => folder.uri.path) ?? [];
  files = files.filter(
    (file) =>
      workspaceFolderNames.find((folder) => path.dirname(file).startsWith(folder)) !== undefined
  );

  return files;
}
