import { json, type RequestHandler } from '../../http';

export const GET: RequestHandler = async () => {
	const currentTime = new Date().toISOString();

	return json({
		time: currentTime,
		timestamp: Date.now()
	});
};
