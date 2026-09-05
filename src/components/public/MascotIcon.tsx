interface MascotIconProps {
	className?: string;
}

export default function MascotIcon({ className }: MascotIconProps) {
	return (
		<svg viewBox="0 0 120 120" className={className} aria-hidden="true" focusable="false">
			<circle cx="60" cy="64" r="48" fill="#ffe8e5" />
			<path d="M22 28 35 56 12 50Z" fill="#ffe8e5" />
			<path d="m98 28-13 28 23-6Z" fill="#ffe8e5" />
			<path d="m24 34 10 19-17-5Z" fill="#ffabb6" />
			<path d="m96 34-10 19 17-5Z" fill="#ffabb6" />
			<ellipse cx="31" cy="71" rx="11" ry="7" fill="#ffb8c0" opacity="0.66" />
			<ellipse cx="89" cy="71" rx="11" ry="7" fill="#ffb8c0" opacity="0.66" />
			<circle cx="42" cy="59" r="9" fill="#3f2b7a" />
			<circle cx="78" cy="59" r="9" fill="#3f2b7a" />
			<circle cx="45" cy="55.5" r="3.2" fill="#fff" />
			<circle cx="81" cy="55.5" r="3.2" fill="#fff" />
			<path
				d="M47 79q13 13 26 0"
				stroke="#3f2b7a"
				strokeWidth="3.2"
				fill="none"
				strokeLinecap="round"
			/>
		</svg>
	);
}
