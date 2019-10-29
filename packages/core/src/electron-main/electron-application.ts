/********************************************************************************
 * Copyright (C) 2019 Ericsson and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

// import { ChildProcess } from 'child_process';
import { BrowserWindow, BrowserWindowConstructorOptions, shell, app, Event as ElectronEvent } from 'electron';
import { ChildProcess, fork } from 'child_process';
import { injectable, named, inject } from 'inversify';
import { AddressInfo } from 'net';

import { ContributionProvider } from '../common/contribution-provider';
import { MaybePromise } from '../common/types';
import { CliContribution } from '../node/cli';

export interface ExecutionParams {
    secondInstance: boolean
    argv: string[]
    cwd: string
}

export const ElectronApplicationSettings = Symbol('ElectronApplicationSettings');
export interface ElectronApplicationSettings {
    THEIA_APP_PROJECT_PATH: string
    THEIA_BACKEND_MAIN_PATH: string
    THEIA_FRONTEND_HTML_PATH: string
}

export const ElectronApplicationContribution = Symbol('ElectronApplicationContribution');
export interface ElectronApplicationContribution {
    /**
     * The application is ready and is starting. This is the time to initialize
     * global services to this process.
     *
     * This event is fired when the process starts for the first time.
     */
    start?(): MaybePromise<void>;
    /**
     * Entry point either after the `start` or `second-instance` events.
     *
     * Hook to this event in order to access resolved command line arguments.
     *
     * If your application is a single-instance application, this hook could be
     * called multiple times.
     */
    launch?(params: ExecutionParams): MaybePromise<void>;
    /**
     * All windows got closed.
     */
    windowAllClosed?(): MaybePromise<void>;
    /**
     * The application is stopping.
     */
    stop?(): MaybePromise<void>;
}

@injectable()
export class ElectronApplication {

    @inject(ContributionProvider) @named(ElectronApplicationContribution)
    protected readonly electronApplicationContributions: ContributionProvider<ElectronApplicationContribution>;

    @inject(ContributionProvider) @named(CliContribution)
    protected readonly electronCliContributions: ContributionProvider<CliContribution>;

    @inject(ElectronApplicationSettings)
    protected readonly settings: ElectronApplicationSettings;

    /**
     * There is no backend process in `devMode`.
     */
    protected backendProcess: ChildProcess | undefined;

    protected _backendPort: number | undefined;
    get backendPort(): number {
        if (typeof this._backendPort === 'undefined') {
            throw new Error('backend port in unavailable.');
        }
        return this._backendPort;
    }

    async start(): Promise<void> {
        this._backendPort = await this.startBackend();
        app.on('will-quit', (event: ElectronEvent) => {
            this.stop();
        });
        app.on('second-instance', (event: ElectronEvent, argv: string[], cwd: string) => {
            this.secondInstance({ argv, cwd, secondInstance: true });
        });
        const promises = [];
        for (const contribution of this.electronApplicationContributions.getContributions()) {
            if (contribution.start) {
                promises.push(contribution.start());
            }
        }
        await Promise.all(promises);
        await this.doLaunch({
            secondInstance: false,
            argv: process.argv,
            cwd: process.cwd(),
        });
    }

    /**
     * Execute the `launch` hooks on contributions.
     */
    protected async doLaunch(params: ExecutionParams): Promise<void> {
        const promises = [];
        for (const contribution of this.electronApplicationContributions.getContributions()) {
            if (contribution.launch) {
                promises.push(contribution.launch(params));
            }
        }
        await Promise.all(promises);
    }

    /**
     * Handler for the `second-instance` event.
     */
    protected async secondInstance(params: ExecutionParams): Promise<void> {
        await this.doLaunch(params);
    }

    /**
     * Use this rather than creating `BrowserWindow` instances from scratch,
     * since some security parameters need to be set, this method will do it.
     *
     * Only a minimal amount of events will be hooked by this method, you still
     * need to bind your own logic on top of the returned `BrowserWindow`.
     *
     * @param options
     */
    createRawWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
        const electronWindow = new BrowserWindow(options);
        // Prevent openning arbitrary links in BrowserWindow instances.
        // A link is to be displayed in the user's default browser.
        electronWindow.webContents.on('new-window', (event, url) => {
            event.preventDefault();
            shell.openExternal(url);
        });
        return electronWindow;
    }

    /**
     * Gently close all windows, application will not stop if a `beforeunload`
     * handler returns `false`.
     */
    requestStop(): void {
        app.quit();
    }

    /**
     * Starts the NodeJS backend server.
     *
     * @return Promise that resolves with the localhost server port.
     */
    protected async startBackend(): Promise<number> {
        const devMode = process.defaultApp || /node_modules[\/]electron[\/]/.test(process.execPath);

        // We cannot use the \`process.cwd()\` as the application project path (the location of the \`package.json\` in other words)
        // in a bundled electron application because it depends on the way we start it. For instance, on OS X, these are a differences:
        // https://github.com/eclipse-theia/theia/issues/3297#issuecomment-439172274
        process.env.THEIA_APP_PROJECT_PATH = this.settings.THEIA_APP_PROJECT_PATH;

        // Set the electron version for both the dev and the production mode. (https://github.com/eclipse-theia/theia/issues/3254)
        // Otherwise, the forked backend processes will not know that they're serving the electron frontend.
        if (process.versions && typeof process.versions.electron !== 'undefined') {
            process.env.THEIA_ELECTRON_VERSION = process.versions.electron;
        }

        return new Promise((resolve, reject) => {
            if (devMode) {
                // The backend server main file is supposed to export a promise
                // resolving with the port used by the http(s) server.
                return require(this.settings.THEIA_BACKEND_MAIN_PATH)
                    .then((address: AddressInfo) => address.port);
            } else {
                // The backend server main file is supposed to also send via IPC
                // the resolved http(s) server port.
                this.backendProcess = fork(this.settings.THEIA_BACKEND_MAIN_PATH, [], {
                    env: { ...process.env },
                });
                // Port number sent over IPC:
                this.backendProcess.on('message', resolve);
                this.backendProcess.on('error', reject);
            }
        });
    }

    protected async stop(): Promise<void> {
        let code = 0;
        const promises = [];
        try {
            for (const contribution of this.electronApplicationContributions.getContributions()) {
                if (contribution.stop) {
                    promises.push(contribution.stop());
                }
            }
            await Promise.all(promises);
        } catch (error) {
            console.error(error);
            code = error && error.code || 1;
        }
        app.exit(code);
    }

}
