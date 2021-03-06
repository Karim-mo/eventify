import asyncHandler from 'express-async-handler';
import nodemailer from 'nodemailer';
import colors from 'colors';

const sendEmail = asyncHandler(async (details) => {
	let transporter = nodemailer.createTransport({
		host: 'smtp.gmail.com',
		port: 465,
		secure: true,
		auth: {
			user: process.env.GMAIL_USER,
			pass: process.env.GMAIL_PW,
		},
	});

	let info = await transporter.sendMail({
		from: process.env.GMAIL_USER,
		to: details.to,
		subject: details.subject || 'Please confirm your email address ✔',
		text:
			details.text ||
			`In order to continue using Eventify, you need to click on the link below to verify your email address.
        http://localhost:3000/confirmation/${details.URL}`,
	});
});

export default sendEmail;
