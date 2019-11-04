/********************************************************************************
 * Copyright (C) 2019 Red Hat, Inc. and others.
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
import { injectable, inject, postConstruct } from 'inversify';
import { JsonSchemaStore } from '@theia/core/lib/browser/json-schema-store';
import { InMemoryResources, deepClone } from '@theia/core/lib/common';
import { IJSONSchema } from '@theia/core/lib/common/json-schema';
import { inputsSchema } from '@theia/variable-resolver/lib/browser/variable-input-schema';
import URI from '@theia/core/lib/common/uri';
import { TaskService } from './task-service';
import { ProblemMatcherRegistry } from './task-problem-matcher-registry';

export const taskSchemaId = 'vscode://schemas/tasks';

@injectable()
export class TaskSchemaUpdater {
    @inject(JsonSchemaStore)
    protected readonly jsonSchemaStore: JsonSchemaStore;

    @inject(InMemoryResources)
    protected readonly inmemoryResources: InMemoryResources;

    @inject(TaskService)
    protected readonly taskService: TaskService;

    @inject(ProblemMatcherRegistry)
    protected readonly problemMatcherRegistry: ProblemMatcherRegistry;

    @postConstruct()
    protected init(): void {
        this.updateProblemMatcherNames();
        // update problem matcher names in the task schema every time a problem matcher is added or disposed
        this.problemMatcherRegistry.onDidChangeProblemMatcher(() => this.updateProblemMatcherNames());
    }

    async update(): Promise<void> {
        const taskSchemaUri = new URI(taskSchemaId);
        const schemaContent = await this.getTaskSchema();
        try {
            this.inmemoryResources.update(taskSchemaUri, schemaContent);
        } catch (e) {
            this.inmemoryResources.add(taskSchemaUri, schemaContent);
            this.jsonSchemaStore.registerSchema({
                fileMatch: ['tasks.json'],
                url: taskSchemaUri.toString()
            });
        }
    }

    private async getTaskSchema(): Promise<string> {
        const taskSchema = {
            properties: {
                tasks: {
                    type: 'array',
                    items: {
                        ...deepClone(taskConfigurationSchema)
                    }
                },
                inputs: inputsSchema.definitions!.inputs
            }
        };
        const taskTypes = await this.taskService.getRegisteredTaskTypes();
        taskSchema.properties.tasks.items.oneOf![0].allOf![0].properties!.type.enum = taskTypes;
        return JSON.stringify(taskSchema);
    }

    /** Gets the most up-to-date names of problem matchers from the registry and update the task schema */
    private updateProblemMatcherNames(): void {
        const matcherNames = this.problemMatcherRegistry.getAll().map(m => m.name.startsWith('$') ? m.name : `$${m.name}`);
        problemMatcherNames.length = 0;
        problemMatcherNames.push(...matcherNames);
        this.update();
    }
}

const commandSchema: IJSONSchema = {
    type: 'string',
    description: 'The actual command or script to execute'
};

const commandArgSchema: IJSONSchema = {
    type: 'array',
    description: 'A list of strings, each one being one argument to pass to the command',
    items: {
        type: 'string'
    }
};

const commandOptionsSchema: IJSONSchema = {
    type: 'object',
    description: 'The command options used when the command is executed',
    properties: {
        cwd: {
            type: 'string',
            description: 'The directory in which the command will be executed',
            default: '${workspaceFolder}'
        },
        env: {
            type: 'object',
            description: 'The environment of the executed program or shell. If omitted the parent process\' environment is used'
        },
        shell: {
            type: 'object',
            description: 'Configuration of the shell when task type is `shell`',
            properties: {
                executable: {
                    type: 'string',
                    description: 'The shell to use'
                },
                args: {
                    type: 'array',
                    description: `The arguments to be passed to the shell executable to run in command mode
                        (e.g ['-c'] for bash or ['/S', '/C'] for cmd.exe)`,
                    items: {
                        type: 'string'
                    }
                }
            }
        }
    }
};

const problemMatcherNames: string[] = [];
const taskConfigurationSchema: IJSONSchema = {
    $id: taskSchemaId,
    oneOf: [
        {
            allOf: [
                {
                    type: 'object',
                    required: ['type'],
                    properties: {
                        label: {
                            type: 'string',
                            description: 'A unique string that identifies the task that is also used as task\'s user interface label'
                        },
                        type: {
                            type: 'string',
                            enum: ['shell', 'process'],
                            default: 'shell',
                            description: 'Determines what type of process will be used to execute the task. Only shell types will have output shown on the user interface'
                        },
                        command: commandSchema,
                        args: commandArgSchema,
                        group: {
                            oneOf: [
                                {
                                    type: 'string'
                                },
                                {
                                    type: 'object',
                                    properties: {
                                        kind: {
                                            type: 'string',
                                            default: 'none',
                                            description: 'The task\'s execution group.'
                                        },
                                        isDefault: {
                                            type: 'boolean',
                                            default: false,
                                            description: 'Defines if this task is the default task in the group.'
                                        }
                                    }
                                }
                            ],
                            enum: [
                                { kind: 'build', isDefault: true },
                                { kind: 'test', isDefault: true },
                                'build',
                                'test',
                                'none'
                            ],
                            enumDescriptions: [
                                'Marks the task as the default build task.',
                                'Marks the task as the default test task.',
                                'Marks the task as a build task accessible through the \'Run Build Task\' command.',
                                'Marks the task as a test task accessible through the \'Run Test Task\' command.',
                                'Assigns the task to no group'
                            ],
                            // tslint:disable-next-line:max-line-length
                            description: 'Defines to which execution group this task belongs to. It supports "build" to add it to the build group and "test" to add it to the test group.'
                        },
                        options: commandOptionsSchema,
                        windows: {
                            type: 'object',
                            description: 'Windows specific command configuration that overrides the command, args, and options',
                            properties: {
                                command: commandSchema,
                                args: commandArgSchema,
                                options: commandOptionsSchema
                            }
                        },
                        osx: {
                            type: 'object',
                            description: 'MacOS specific command configuration that overrides the command, args, and options',
                            properties: {
                                command: commandSchema,
                                args: commandArgSchema,
                                options: commandOptionsSchema
                            }
                        },
                        linux: {
                            type: 'object',
                            description: 'Linux specific command configuration that overrides the default command, args, and options',
                            properties: {
                                command: commandSchema,
                                args: commandArgSchema,
                                options: commandOptionsSchema
                            }
                        },
                        problemMatcher: {
                            oneOf: [
                                {
                                    type: 'string',
                                    description: 'Name of the problem matcher to parse the output of the task',
                                    enum: problemMatcherNames
                                },
                                {
                                    type: 'object',
                                    description: 'User defined problem matcher(s) to parse the output of the task',
                                },
                                {
                                    type: 'array',
                                    description: 'Name(s) of the problem matcher(s) to parse the output of the task',
                                    items: {
                                        type: 'string',
                                        enum: problemMatcherNames
                                    }
                                }
                            ]
                        }
                    }
                }
            ]
        }
    ]
};
