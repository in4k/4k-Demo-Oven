import { pathExistsSync, statSync } from 'fs-extra';
import { Provider } from 'nconf';
import * as yaml from 'nconf-yaml';
import { dirname, join } from 'path';

import {
	IConfig,
	IShaderDefinition,
	IShaderMinifier,
	IShaderProvider,
	Variable,
} from './definitions';
import { ShaderMinifierShaderMinifier } from './shader-minifiers/shader-minifier';
import { SimpleShaderProvider } from './shader-providers/simple';
import { SynthclipseShaderProvider } from './shader-providers/synthclipse';
import { addConstant } from './variables';

export interface IOptions {
	capture: boolean;
}

export function getConfig(options: IOptions): IConfig {
	const config = new Provider();

	config.set('capture', options.capture);

	config
		.use('memory')
		.env()
		.argv({
			debug: {
				alias: 'd',
				default: false,
				describe: 'Compile a debugging version.',
				type: 'boolean',
			},
			directory: {
				alias: 'dir',
				default: 'demo',
				describe: 'Home of your demo-specific files.',
				type: 'string',
			},
			execute: {
				alias: 'x',
				default: false,
				describe: 'Execute after a successful build.',
				type: 'boolean',
			},
			minify: {
				alias: 'm',
				default: true,
				describe: 'Minify shader.',
				type: 'boolean',
			},
			notify: {
				alias: 'n',
				default: false,
				describe: 'Display a notification when build ends.',
				type: 'boolean',
			},
			zip: {
				alias: 'z',
				default: false,
				describe: 'Zip the exe after a successful build.',
				type: 'boolean',
			},
		});

	const demoDirectory = config.get('directory');

	if (pathExistsSync(demoDirectory)) {
		const stats = statSync(demoDirectory);
		if (!stats.isDirectory()) {
			throw new Error('Demo directory is not a directory.');
		}
	} else {
		throw new Error('Demo directory does not exist.');
	}

	config
		.file('demo-local', {
			file: join(demoDirectory, 'config.local.yml'),
			format: yaml,
		})
		.file('local', {
			file: 'config.local.yml',
			format: yaml,
		})
		.file('demo', {
			file: join(demoDirectory, 'config.yml'),
			format: yaml,
		});

	const variables: Variable[] = [];

	if (config.get('capture')) {
		config.set('forceResolution', true);
		addConstant(
			variables,
			'float',
			'resolutionWidth',
			config.get('capture:width')
		);
		addConstant(
			variables,
			'float',
			'resolutionHeight',
			config.get('capture:height')
		);
	} else {
		if (
			config.get('demo:resolution:width') > 0 &&
			config.get('demo:resolution:height') > 0
		) {
			config.set('forceResolution', true);
			addConstant(
				variables,
				'float',
				'resolutionWidth',
				config.get('demo:resolution:width')
			);
			addConstant(
				variables,
				'float',
				'resolutionHeight',
				config.get('demo:resolution:height')
			);
		}
	}

	let demoAudio = null;

	switch (config.get('demo:audio:tool')) {
		case 'oidos':
			demoAudio = {
				filename: 'music.xrns',
			};
			break;
	}

	let shaderProvider: IShaderProvider;
	switch (config.get('demo:shaderProvider:tool') || 'simple') {
		case 'simple':
			shaderProvider = new SimpleShaderProvider(config);
			break;

		case 'synthclipse':
			shaderProvider = new SynthclipseShaderProvider(config);
			break;

		default:
			throw new Error('Config key "demo:shaderProvider:tool" is not valid.');
	}

	let shaderMinifier: IShaderMinifier;
	switch (config.get('demo:shaderMinifier:tool') || 'shader-minifier') {
		case 'shader-minifier':
			shaderMinifier = new ShaderMinifierShaderMinifier(config);
			break;

		default:
			throw new Error('Config key "demo:shaderMinifier:tool" is not valid.');
	}

	if (options.capture) {
		config.overrides({
			capture: {
				fps: 60,
				height: 1080,
				width: 1920,
			},
		});
	}

	config.defaults({
		cl: {
			args: config.get('debug')
				? ['/EHsc']
				: ['/O1', '/Oi', '/Oy', '/GR-', '/GS-', '/fp:fast', '/arch:IA32'],
		},
		crinkler: {
			args: [
				'/ENTRY:main',
				'/PRIORITY:NORMAL',
				'/COMPMODE:FAST',
				'/RANGE:opengl32',
				// '/TRUNCATEFLOATS:16',
				'/UNSAFEIMPORT',
				'winmm.lib',
				'gdi32.lib',
				'opengl32.lib',
				'kernel32.lib',
				'user32.lib',
			],
		},
		demo: {
			audio: Object.assign(
				{
					tool: 'none', // in 4klang, 8klang, none, oidos, shader
				},
				demoAudio
			),
			closeWhenFinished: false,
			gl: {
				constants: [],
				functions: [],
			},
			hooks: {
				declarations: 'declarations.cpp',
				initialize: 'initialize.cpp',
				render: 'render.cpp',
			},
			loadingBlackScreen: false,
			// name
			resolution: {
				// height
				// scale
				// width
			},
			shaderProvider: Object.assign(
				{
					tool: 'none', // in none, synthclipse
				},
				shaderProvider.getDefaultConfig()
			),
		},
		link: {
			args: [
				'/SUBSYSTEM:CONSOLE',
				'/MACHINE:X86',
				'winmm.lib',
				'gdi32.lib',
				'opengl32.lib',
				'kernel32.lib',
				'user32.lib',
			],
		},
		paths: {
			build: 'build',
			get dist() {
				return dirname(config.get('paths:exe'));
			},
			exe: join('dist', config.get('demo:name') + '.exe'),
			get frames() {
				return join(config.get('paths:build'), 'frames');
			},
		},
		tools: {
			// 4klang
			'7z': '7z',
			// 8klang
			crinkler: 'crinkler',
			ffmpeg: 'ffmpeg',
			// glext
			mono: 'mono',
			nasm: 'nasm',
			// oidos
			python2: 'python',
		},
	});

	config.required([
		'cl:args',
		'demo:name',
		'paths:build',
		'paths:exe',
		'tools:glext',
	]);

	if (options.capture) {
		config.required(['paths:frames', 'tools:ffmpeg']);
	}

	if (config.get('debug')) {
		config.required(['link:args']);
	} else {
		config.required(['crinkler:args', 'tools:crinkler']);
	}

	if (
		['4klang', '8klang', 'none', 'oidos', 'shader'].indexOf(
			config.get('demo:audio:tool')
		) === -1
	) {
		throw new Error('Config key "demo:audio:tool" is not valid.');
	}

	switch (config.get('demo:audio:tool')) {
		case '4klang':
			config.required(['tools:4klang']);
			break;

		case '8klang':
			config.required(['tools:8klang']);
			break;

		case 'oidos':
			config.required(['tools:oidos', 'tools:python2']);
			break;
	}

	if (config.get('zip')) {
		config.required(['tools:7z']);
	}

	return {
		async provideShaderDefinition() {
			const definition: IShaderDefinition = {
				commonCode: '',
				passes: [],
				uniformArrays: {},
				variables,
			};

			await shaderProvider.provide(definition);

			if (definition.passes.length === 0) {
				throw new Error('Shader should define at least one pass.');
			}

			// Replace constants by their value.
			// Deactivate unreferenced variables.
			variables.forEach((variable) => {
				if (variable.active) {
					const usageRegExp = new RegExp(`\\b${variable.name}\\b`, 'g');

					if (variable.kind === 'const') {
						console.log(
							`Replacing references to constant "${variable.name}" by its value "${variable.value}".`
						);

						if (definition.prologCode) {
							definition.prologCode = definition.prologCode.replace(
								usageRegExp,
								variable.value
							);
						}

						definition.commonCode = definition.commonCode.replace(
							usageRegExp,
							variable.value
						);

						definition.passes.forEach((pass) => {
							if (pass.vertexCode) {
								pass.vertexCode = pass.vertexCode.replace(
									usageRegExp,
									variable.value
								);
							}

							if (pass.fragmentCode) {
								pass.fragmentCode = pass.fragmentCode.replace(
									usageRegExp,
									variable.value
								);
							}
						});

						variable.active = false;
					} else {
						const commonMatch = definition.commonCode.match(usageRegExp);
						let referenced = commonMatch ? commonMatch.length > 0 : false;

						if (
							definition.passes.some((pass) => {
								if (pass.fragmentCode) {
									const fragmentMatch = pass.fragmentCode.match(usageRegExp);
									if (fragmentMatch && fragmentMatch.length > 0) {
										return true;
									}
								}
								if (pass.vertexCode) {
									const vertexMatch = pass.vertexCode.match(usageRegExp);
									if (vertexMatch && vertexMatch.length > 0) {
										return true;
									}
								}
								return false;
							})
						) {
							referenced = true;
						}

						if (!referenced) {
							console.log(
								`Global variable "${variable.name}" is not referenced and won't be used.`
							);

							variable.active = false;
						}
					}
				}
			});

			variables.forEach((variable) => {
				if (!variable.active) {
					return;
				}

				if (variable.kind === 'uniform') {
					if (!definition.uniformArrays[variable.type]) {
						definition.uniformArrays[variable.type] = {
							name: variable.type + 'Uniforms',
							variables: [],
						};
					}

					const index =
						definition.uniformArrays[variable.type].variables.length;
					definition.uniformArrays[variable.type].variables.push(variable);

					const usageRegExp = new RegExp(`\\b${variable.name}\\b`, 'g');
					const newWriting =
						definition.uniformArrays[variable.type].name + '[' + index + ']';

					definition.commonCode = definition.commonCode.replace(
						usageRegExp,
						newWriting
					);

					definition.passes.forEach((pass) => {
						if (pass.fragmentCode) {
							pass.fragmentCode = pass.fragmentCode.replace(
								usageRegExp,
								newWriting
							);
						}
						if (pass.vertexCode) {
							pass.vertexCode = pass.vertexCode.replace(
								usageRegExp,
								newWriting
							);
						}
					});
				}
			});

			if (config.get('minify')) {
				await shaderMinifier.minify(definition);
			}

			const globalsByTypes: { [type: string]: string[] } = {};
			variables.forEach((variable) => {
				if (!variable.active) {
					return;
				}

				if (variable.kind !== 'uniform') {
					if (!globalsByTypes[variable.type]) {
						globalsByTypes[variable.type] = [];
					}

					let str = variable.minifiedName || variable.name;
					if (variable.kind === 'const') {
						str += ' = ' + variable.value;
					}
					globalsByTypes[variable.type].push(str);
				}
			});

			if (definition.glslVersion) {
				definition.prologCode = `#version ${definition.glslVersion}\n`;
			}

			definition.commonCode =
				Object.keys(definition.uniformArrays)
					.map((type) => {
						const uniformArray = definition.uniformArrays[type];
						return `uniform ${type} ${uniformArray.minifiedName ||
							uniformArray.name}[${uniformArray.variables.length}];`;
					})
					.concat(
						Object.keys(globalsByTypes).map((type) => {
							return type + ' ' + globalsByTypes[type].join(',') + ';';
						})
					)
					.join('') + definition.commonCode;

			return definition;
		},

		get(key) {
			return config.get(key);
		},
	};
}
