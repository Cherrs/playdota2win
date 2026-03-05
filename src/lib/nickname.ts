/**
 * Dota 2 themed nickname generation.
 * Modifiers are hardcoded; keywords come from admin config via KV.
 */

export const NICKNAME_MODIFIERS: Record<string, string[]> = {
	战绩: [
		'超神',
		'暴走',
		'团灭',
		'送一血',
		'MVP',
		'如鱼得水',
		'主宰比赛',
		'无人能挡',
		'大杀特杀',
		'godlike'
	],
	段位: ['青铜', '传奇', '万古流河', '冠绝一世', '不朽', '先知', '卫士', '统帅'],
	位置: ['带飞', '打野', '辅助', '中单', 'Carry', '游走', '工具人', '混子'],
	风格: ['莽夫', '快乐', '逆风翻盘', '偷塔', '挂机', '速推', '猥琐发育', '敢死队']
};

type TemplateFunction = (modifier: string, keyword: string) => string;

const NICKNAME_TEMPLATES: TemplateFunction[] = [
	(m, k) => `${m}${k}`,
	(m, k) => `${m}的${k}`,
	(m, k) => `${k}${m}`
];

function randomItem<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

export function generateRandomNickname(keywords: string[]): string {
	if (keywords.length === 0) {
		return `游客${Math.floor(Math.random() * 9000 + 1000)}`;
	}
	const keyword = randomItem(keywords);
	const categoryKeys = Object.keys(NICKNAME_MODIFIERS);
	const category = randomItem(categoryKeys);
	const modifier = randomItem(NICKNAME_MODIFIERS[category]);
	const template = randomItem(NICKNAME_TEMPLATES);
	const result = template(modifier, keyword);
	return result.slice(0, 24);
}
