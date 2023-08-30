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
let modPath = "C:\\Path\\To\\Noita\\mods";
let dataPath = "C:\\Path\\To\\Noita\\data";
let linux = false;
let suggestions = true;

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
			known_paths.push(path.join(extra, next).toLowerCase());
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

connection.onInitialized(async () => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (await CheckModDir()) { return; }
	connection.onNotification("noita/filesaved", (uri: string) => {
		if (uri.slice(1).toLowerCase().startsWith(dataPath.toLowerCase().split(/\\/).join("/"))) {
			const stripped: string = "\"" + uri.slice(uri.indexOf("data")) + "\"";
			if (!known_paths.includes(stripped.toLowerCase())) {
				known_paths.push(stripped.toLowerCase());
			}
		}
		else if (uri.slice(1).toLowerCase().startsWith(modPath.toLowerCase().split(/\\/).join("/"))) {
			const stripped: string = "\"" + uri.slice(uri.indexOf("mods")) + "\"";
			if (!known_paths.includes(stripped.toLowerCase())) {
				known_paths.push(stripped.toLowerCase());
			}
		}
	});
	connection.onNotification("noita/filedeleted", (uri: string) => {
		if (uri.slice(1).toLowerCase().startsWith(dataPath.toLowerCase().split(/\\/).join("/"))) {
			const stripped: string = "\"" + uri.slice(uri.indexOf("data")) + "\"";
			if (known_paths.includes(stripped.toLowerCase())) {
				known_paths = known_paths.filter(e => e !== stripped.toLowerCase());
			}
		}
		else if (uri.slice(1).toLowerCase().startsWith(modPath.toLowerCase().split(/\\/).join("/"))) {
			const stripped: string = "\"" + uri.slice(uri.indexOf("mods")) + "\"";
			if (known_paths.includes(stripped.toLowerCase())) {
				known_paths = known_paths.filter(e => e !== stripped.toLowerCase());
			}
		}
	});
	connection.sendRequest("noita/config").then(async v => {
		await doConf([(v as string[])[0], (v as string[])[1]], [(v as boolean[])[2], (v as boolean[])[3]]);
		doBase(dataPath, "data/");
		doBase(modPath, "mods/");
		connection.console.log("Noita File Autocomplete: Finished generating.");
	}
	);
});

async function doConf(v: string[], b: boolean[]) {
	dataPath = (v)[0];
	if (dataPath == "C:\\Path\\To\\Noita\\data") {
		dataPath = process.env.APPDATA?.split("\\").slice(0, -1).join("\\") + "\\LocalLow\\Nolla_Games_Noita\\data";
	}
	modPath = (v)[1];
	linux = (b)[0];
	suggestions = (b)[1];
	await connection.sendNotification("noita/paths", [dataPath, modPath]);
}

connection.onDidChangeConfiguration(async _change => {
	if (await CheckModDir()) { return; }
	await connection.sendRequest("noita/config").then(async v => {
		await doConf([(v as string[])[0], (v as string[])[1]], [(v as boolean[])[2], (v as boolean[])[3]]);
	}
	);
	documents.all().forEach(validateTextDocument);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
const dofilePattern = /dofile(_once)?\(\s*"((mods\/[a-z|_|0-9]+)|data)\/([a-z|_|0-9]+\/){1,}[a-z|_|0-9]+?\.(xml|frag|lua|png)"/g;
documents.onDidChangeContent(async change => {
	if (await CheckModDir()) { return; }
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
				const path = (dofiles[i].charAt(1) == "m" ? modPath : dataPath) + "/" + dofiles[i].slice(dofiles[i].indexOf("/")); // recursive dofile getter
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
	if (await CheckModDir()) { return; }
	// Create incorrect path errors
	const text = textDocument.getText();
	let match: RegExpExecArray | null;
	const diagnostics: Diagnostic[] = [];
	while ((match = pathPattern.exec(text)) !== null) {
		let found = false;
		if (known_paths.includes(match[0].toLowerCase())) { continue; }
		known_paths.forEach(e => {
			if (match === null) { return; } // stupid typescript
			if (e.endsWith(match[0].slice(1))) { // no starting quote
				found = true;
			}
		});
		if (found) { continue; }
		let bad = false;
		if (match[0].startsWith("\"mods/")) {
			const mod_name = match[0].slice(0, match[0].slice(6).indexOf("/") + 6).toLowerCase(); // "1m2o3d4s5/6
			known_paths.forEach(element => {
				if (element.startsWith(mod_name)) {
					bad = true;
				}
			});
		}
		const diagnostic: Diagnostic = {
			severity: bad ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
			range: {
				start: textDocument.positionAt(match.index),
				end: textDocument.positionAt(match.index + match[0].length)
			},
			message: (`${match[0]} is not a ` + (bad ? "valid" : "known") + ` Noita filepath.`),
			source: 'Noita File Autocomplete'
		};
		diagnostics.push(diagnostic);
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// This handler provides the initial list of the completion items.
connection.onCompletion(
	async (_textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
		if (!suggestions) { return []; }
		if (await CheckModDir()) { return []; }
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
	async (params): Promise<Location[]> => {
		if (await CheckModDir()) { return []; }
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
			if (!known_paths.includes(result[0].toLowerCase() + "\"")) { continue; }
			const target = (linux ? "file://" : "file:///") + (result[0].charAt(1) == "m" ? modPath : dataPath) + result[0].slice(result[0].indexOf("/"));
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

function CheckModDir() {
	return connection.sendRequest("noita/config").then(async (v) => {
		await doConf([(v as string[])[0], (v as string[])[1]], [(v as boolean[])[2], (v as boolean[])[3]]);
		if (modPath === "C:\\Path\\To\\Noita\\mods") {
			connection.window.showErrorMessage("Set your mod path then restart!");
			return true;
		}
		return false;
	});
}

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();