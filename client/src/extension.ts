/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import { workspace, ExtensionContext } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';
import * as vscode from "vscode";
let client: LanguageClient;
let config;
let modPath = path.join("D:", "Steam", "steamapps", "common", "Noita", "mods");
let dataPath = path.join("C:", "Users", "natha", "AppData", "LocalLow", "Nolla_Games_Noita", "data");

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
		}
	};

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: 'file' }],
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'NoitaFileAutocomplete',
		'Noita File Autocomplete',
		serverOptions,
		clientOptions
	);

	config = vscode.workspace.getConfiguration("Lua"); // steal the moon
	client.onNotification("noita/dofile", (files: string[]) => {
		handleDoFiles(files);
	});
	client.onRequest("noita/document", _ => {
		const v = vscode.window.activeTextEditor;
		if (v) {
			return v.document.getText();
		}
		return undefined;
		// to[0] = vscode.window.activeTextEditor.document.fileName;
	});
	const commands: vscode.Disposable = vscode.commands.registerCommand(
		"noita-file-autocomplete.getPath",
		(_): void => {
			const page = vscode.window.activeTextEditor;
			if (page === undefined) {
				return;
			}
			const path = page.document.uri.toString();
			let done;
			if (path.includes("mods/")) {
				done = path.slice(path.indexOf("mods"));
			}
			else {
				done = path.slice(path.indexOf("data"));
			}
			vscode.env.clipboard.writeText(done);
		}
	);
	context.subscriptions.push(commands);
	client.onRequest("noita/config", _ => {
		dataPath = vscode.workspace.getConfiguration("noita-file-autocomplete").get("dataPath");
		modPath = vscode.workspace.getConfiguration("noita-file-autocomplete").get("modPath");
		return [dataPath, modPath];
		// to[0] = vscode.window.activeTextEditor.document.fileName;
	});
	dataPath = vscode.workspace.getConfiguration("noita-file-autocomplete").get("dataPath");
	modPath = vscode.workspace.getConfiguration("noita-file-autocomplete").get("modPath");
	client.start(); // i think we are supposed to use a disposable thingy here but idc
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

const known: string[] = [];
let base = "";
function handleDoFiles(dofiles: string[]) {
	config = vscode.workspace.getConfiguration("Lua");
	const detected = config.get("workspace.library");
	for (let i = 0; i < detected.length; i++) {
		if (detected[i].includes("evaisa")) // a small amount of tomfoolery
		{
			base = detected[i];
		}
	}
	const marked = [];
	for (let i = 0; i < known.length; i++) {
		const file = known[i];
		if (!dofiles.includes(file)) {
			marked.push(i);
		}
	}
	for (let i = 0; i < marked.length; i++) {
		const id = marked[i] - i;
		known.splice(id, 1);
	}
	for (let i = 0; i < dofiles.length; i++) {
		const file = dofiles[i];
		if (!known.includes(file)) {
			known.push(file);
		}
	}
	for (let i = 0; i < known.length; i++) {
		known[i] = (known[i].charAt(1) == "m" ? modPath : dataPath) + known[i].slice(known[i].indexOf("/")).replace(/\//g, "\\");
	}
	known.push(base);
	if (known.sort().join('|||') !== detected.sort().join('|||')) { // hax
		config.update("workspace.library", known, true);
	}
	config = vscode.workspace.getConfiguration("Lua");
}
