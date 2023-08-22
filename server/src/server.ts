/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	TextDocumentIdentifier,
	Location,
	Definition,
	HandlerResult
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import fs = require("fs");
import path = require("path");

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);
let modPath = path.join("D:", "Steam", "steamapps", "common", "Noita", "mods");
let dataPath = path.join("C:", "Users", "natha", "AppData", "LocalLow", "Nolla_Games_Noita", "data");

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;
let known_paths: string[] = [];
connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true
			},
			definitionProvider: true
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

function doBase(base: string, extra: string) {
	let traverse_paths = [];
	traverse_paths = fs.readdirSync(base);
	while (traverse_paths.length != 0) {

		const next = traverse_paths[0];
		if (fs.lstatSync(path.join(base, next)).isFile()) {
			known_paths.push(path.join(extra, next));
			traverse_paths.shift();
			continue;
		}
		const discovered = fs.readdirSync(path.join(base, next));
		// known_paths.push(next); // directory listing
		while (discovered.length != 0) {
			if (discovered[0].includes(".git")) {
				discovered.shift();
				continue;
			}
			traverse_paths.push(path.join(next, discovered.shift() || ""));
		}
		traverse_paths.shift();
	}
	const replacer = new RegExp(/\\/g);
	for (let i = 0; i < known_paths.length; i++) {
		if (known_paths[i].charAt(0) == "\"") { continue; }
		known_paths[i] = "\"" + known_paths[i].replace(replacer, "/") + "\"";
	}
}

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
	connection.onNotification("noita/filesaved", (uri: string) => {
		if (uri.slice(1).toLowerCase().startsWith(dataPath.toLowerCase().split(/\\/).join("/"))) {
			const stripped: string = "\"" + uri.slice(uri.indexOf("data")) + "\"";
			if (!known_paths.includes(stripped)) {
				known_paths.push(stripped);
			}
		}
		else if (uri.slice(1).toLowerCase().startsWith(modPath.toLowerCase().split(/\\/).join("/"))) {
			const stripped: string = "\"" + uri.slice(uri.indexOf("mods")) + "\"";
			if (!known_paths.includes(stripped)) {
				known_paths.push(stripped);
			}
		}
	});
	connection.onNotification("noita/filedeleted", (uri: string) => {
		if (uri.slice(1).toLowerCase().startsWith(dataPath.toLowerCase().split(/\\/).join("/"))) {
			const stripped: string = "\"" + uri.slice(uri.indexOf("data")) + "\"";
			if (known_paths.includes(stripped)) {
				known_paths = known_paths.filter(e => e !== stripped);
			}
		}
		else if (uri.slice(1).toLowerCase().startsWith(modPath.toLowerCase().split(/\\/).join("/"))) {
			const stripped: string = "\"" + uri.slice(uri.indexOf("mods")) + "\"";
			if (known_paths.includes(stripped)) {
				known_paths = known_paths.filter(e => e !== stripped);
			}
		}
	});
	connection.sendRequest("noita/config").then(v => {
		console.log(v);
		doConf(v as string[]);
		doBase(dataPath, "data/");
		doBase(modPath, "mods/");
		connection.console.log("Noita File Autocomplete: Finished generating.");
	}
	);
});

function doConf(v: string[]) {
	dataPath = (v)[0];
	modPath = (v)[1];

}

connection.onDidChangeConfiguration(_change => {
	connection.sendRequest("noita/document").then(v => {
		doConf(v as string[]);
	}
	);
	documents.all().forEach(validateTextDocument);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
const dofilePattern = /dofile(_once)?\(\s*"((mods\/[a-z|_|0-9]+)|data)\/([a-z|_|0-9]+\/){1,}[a-z|_|0-9]+?\.(xml|frag|lua|png)"/g;
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
	const arr: any = [];

	let text = "";
	connection.sendRequest("noita/document").then(v => {
		if (v) {
			text = v as string; // get current text without fs (no delay to edits)
		}
		else {
			return;
		}
		// await strangeness means stuff runs in the wrong order if i don't do this
		let match: RegExpExecArray | null;
		const dofiles = [];
		while ((match = dofilePattern.exec(text)) !== null) {
			dofiles.push(match[0].slice(match[0].indexOf("\""), -1));
		}
		for (let i = 0; i < dofiles.length; i++) // mutate end only so safe
		{
			try {
				const path = (dofiles[i].charAt(1) == "m" ? modPath : dataPath) + "\\" + dofiles[i].slice(dofiles[i].indexOf("/")).replace(/\//g, "\\"); // recursive dofile getter
				const content = fs.readFileSync(path).toString();
				while ((match = dofilePattern.exec(content)) !== null) {
					dofiles.push(match[0].slice(match[0].indexOf("\""), -1));
				}
			}
			catch
			{
				continue;
			}
		}
		connection.sendNotification("noita/dofile", dofiles);
	});
});

const pathPattern = /"((mods\/[a-z|_|0-9]+)|data)\/([a-z|_|0-9]+\/){1,}[a-z|_|0-9]+?\.(xml|frag|lua|png)"/g;
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	// Create incorrect path errors
	const text = textDocument.getText();
	let match: RegExpExecArray | null;
	let problems = 0;
	const diagnostics: Diagnostic[] = [];
	while ((match = pathPattern.exec(text)) !== null) {
		problems++;
		if (known_paths.includes(match[0])) { continue; }
		const diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Error,
			range: {
				start: textDocument.positionAt(match.index),
				end: textDocument.positionAt(match.index + match[0].length)
			},
			message: `${match[0]} is not a valid noita filepath.`,
			source: 'Noita File Autocomplete'
		};
		diagnostics.push(diagnostic);
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		const ret: CompletionItem[] = []; // send completions, ideally we could cache this on client but idk how
		for (let i = 0; i < known_paths.length; i++) {
			ret[i] = { label: known_paths[i], kind: CompletionItemKind.Text };
		}
		return ret;
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		return item;
	}
);

connection.onDefinition(
	(params): Location[] => {
		const currentFile = documents.get(params.textDocument.uri);
		if (currentFile === undefined) { return []; }
		const lineWithRef = currentFile.getText({
			start: { line: params.position.line, character: 0 },
			end: { line: params.position.line + 1, character: 0 }
		});
		const reg = /("|')(data|mods)\/[^\n]+?\.(xml|lua|png|csv)/g;
		let result;
		const results: Location[] = [];
		while ((result = reg.exec(lineWithRef)) !== null) {
			const first = result.index;
			const last = first + result[0].length - 1;
			if (!known_paths.includes(result[0] + "\"")) { continue; }
			const target = "file:///" + (result[0].charAt(1) == "m" ? modPath : dataPath).replace("/", "\\") + "/" + result[0].slice(result[0].indexOf("/"));
			results.push({
				uri: target,
				range: {
					start: { line: 0, character: first },
					end: { line: 1, character: last }
				}
			} as Location);
		}
		return results;
	}
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();