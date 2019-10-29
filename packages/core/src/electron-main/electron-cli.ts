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
/**
 * We do not want to use the singleton `yargs` here.
 */
const createParser: () => yargs.Argv = require('yargs/yargs');

import { injectable, named, inject } from 'inversify';

import { ContributionProvider } from '../common/contribution-provider';
import { MaybePromise } from '../common/types';

export const ElectronCliContribution = Symbol('ElectronCliContribution');
// tslint:disable-next-line:no-any
export interface ElectronCliContribution<T extends object = any> {

    /**
     * Configure the CLI parser with your options/commands.
     */
    configure(yargs: yargs.Argv): MaybePromise<void>;

    /**
     * Return the resolved arguments, these will be saved in an
     * `ExecutionContext` instance for contributions to fetch from.
     */
    setArguments(args: yargs.Arguments): MaybePromise<T>;

}

@injectable()
export class ElectronCliManager {

    @inject(ContributionProvider) @named(ElectronCliContribution)
    protected readonly cliContributions: ContributionProvider<ElectronCliContribution>;

    async parse(cwd: string, argv: string[]): Promise<ExecutionContext> {
        const packageJson = require('../../package.json');
        const parser = createParser()
            .version(packageJson.version)
            .exitProcess(false)
            .detectLocale(false)
            .showHelpOnFail(false, 'Specify --help for available options')
            .help();

        const configurePromises = [];
        for (const contribution of this.cliContributions.getContributions()) {
            configurePromises.push(contribution.configure(parser));
        }
        await Promise.all(configurePromises);

        const args = parser.parse(argv);

        const argumentPromises = [];
        for (const contribution of this.cliContributions.getContributions()) {
            argumentPromises.push([contribution, contribution.setArguments(args)] as const);
        }
        const results = await Promise.all(argumentPromises);
        return new ExecutionContext(cwd, new Map(results));
    }

}

/**
 * An electron application CLI can be run multiple times. An execution context
 * represents the state of the different CLI options for a given execution.
 */
export class ExecutionContext {

    constructor(
        readonly cwd: string,
        protected readonly parameters: Map<ElectronCliContribution, object>,
    ) { }

    /**
     * Returns the resolved arguments for a given `ElectronCliContribution` instance.
     *
     * @param contribution `ElectronCliContribution` instance to fetch data from.
     */
    get<T extends object>(contribution: ElectronCliContribution<T>): T | undefined {
        return this.parameters.get(contribution) as T | undefined;
    }

}
