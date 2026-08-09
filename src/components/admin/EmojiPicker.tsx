import { useState } from 'react';
import { classNames } from './classNames';
import styles from './EmojiPicker.module.css';

interface EmojiPickerProps {
	value?: string;
	onSelect: (emoji: string) => void;
}

const EMOJI_CATEGORIES = [
	{
		name: '常用',
		emojis: ['🔧', '📚', '🎮', '🎨', '💼', '📦', '🌟', '✨', '💎', '🎯', '🚀', '⚡']
	},
	{
		name: '工具',
		emojis: ['🔧', '🛠️', '⚙️', '🔨', '🪛', '⚗️', '🧰', '📐', '📏', '🔬', '🔭', '🧲']
	},
	{
		name: '文档',
		emojis: ['📄', '📃', '📑', '📊', '📈', '📉', '📚', '📖', '📝', '📋', '📌', '📍']
	},
	{
		name: '游戏',
		emojis: ['🎮', '🕹️', '🎯', '🎲', '🃏', '🎰', '🎳', '🎪', '🎭', '🎨', '🖌️', '🖍️']
	},
	{
		name: '符号',
		emojis: ['⭐', '🌟', '✨', '💫', '🔥', '💧', '⚡', '💥', '💢', '💨', '💦', '🌈']
	},
	{
		name: '物品',
		emojis: ['💼', '👜', '🎒', '💰', '💳', '💎', '🔮', '🎁', '🎀', '🎊', '🎉', '🎈']
	},
	{ name: '其他', emojis: ['🌸', '🌺', '🌻', '🌹', '🌷', '🌼', '🏵️', '🌿', '🍀', '🍃', '🎋', '🎍'] }
] as const;

export default function EmojiPicker({ value = '', onSelect }: EmojiPickerProps) {
	const [selectedCategory, setSelectedCategory] = useState(0);
	const [hoveredEmoji, setHoveredEmoji] = useState<string | null>(null);

	return (
		<div className={styles.picker}>
			<div className={styles.tabs}>
				{EMOJI_CATEGORIES.map((category, index) => (
					<button
						key={category.name}
						type="button"
						className={classNames(styles.tab, selectedCategory === index && styles.active)}
						onClick={() => setSelectedCategory(index)}
					>
						{category.name}
					</button>
				))}
			</div>

			<div className={styles.grid}>
				{EMOJI_CATEGORIES[selectedCategory].emojis.map((emoji) => (
					<button
						key={emoji}
						type="button"
						title={emoji}
						className={classNames(
							styles.emoji,
							value === emoji && styles.selected,
							hoveredEmoji === emoji && styles.hovered
						)}
						onClick={() => onSelect(emoji)}
						onMouseEnter={() => setHoveredEmoji(emoji)}
						onMouseLeave={() => setHoveredEmoji(null)}
					>
						{emoji}
					</button>
				))}
			</div>

			{value ? (
				<div className={styles.preview}>
					<span className={styles.previewLabel}>已选择：</span>
					<span className={styles.previewEmoji}>{value}</span>
					<button className={styles.clear} type="button" onClick={() => onSelect('')}>
						×
					</button>
				</div>
			) : null}
		</div>
	);
}
