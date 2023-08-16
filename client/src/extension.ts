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
			return v.document.fileName;
		}
		return undefined;
		// console.log(vscode.window.activ eTextEditor.document.fileName);
		// to[0] = vscode.window.activeTextEditor.document.fileName;
	});
	client.start(); // i think we are supposed to use a disposable thingy here but idc
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

const known: string[] = [];
const modPath = path.join("D:", "Steam", "steamapps", "common", "Noita", "mods");
const dataPath = path.join("C:", "Users", "natha", "AppData", "LocalLow", "Nolla_Games_Noita", "data");
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
		console.log(known);
		console.log("updated");
	}
	config = vscode.workspace.getConfiguration("Lua");
}