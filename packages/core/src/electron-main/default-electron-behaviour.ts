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

import yargs = require('yargs');
const createYargs: (argv?: string[], cwd?: string) => yargs.Argv = require('yargs/yargs');

import { injectable, inject } from 'inversify';
import { realpathSync } from 'fs';

import { ElectronApplicationContribution, ElectronApplication, ElectronApplicationSettings, ExecutionParams } from './electron-application';
import URI from '../common/uri';
import { resolve } from 'path';

/**
 * Override this binding to setup your own electron behavior, i.e.: What to do
 * when a user launches your application.
 */
export const ElectronBehavior = Symbol('ElectronBehavior');

@injectable()
export class DefaultElectronBehavior implements ElectronApplicationContribution {

    @inject(ElectronApplication)
    protected readonly app: ElectronApplication;

    @inject(ElectronApplicationSettings)
    protected readonly settings: ElectronApplicationSettings;

    launch(params: ExecutionParams): void {
        createYargs(params.argv, params.cwd)
            .command('$0 [<file>]', false,
                cmd => cmd
                    .positional('file', { type: 'string' }),
                args => this.handleFile(params, args.file),
            ).parse();
    }

    protected handleFile(params: ExecutionParams, file?: string): void {
        const window = this.app.createRawWindow({
            show: false,
        });
        window.on('ready-to-show', () => window.show());

        let url = new URI()
            .withScheme('file')
            .withPath(this.settings.THEIA_FRONTEND_HTML_PATH)
            .withQuery(`port=${this.app.backendPort}`);

        if (typeof file === 'string') {
            url = url.withFragment(realpathSync(resolve(params.cwd, file)));
        }

        window.loadURL(url.toString(true));
    }
}
