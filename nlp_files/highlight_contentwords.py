import nltk
import sys

#Example usage:
# python .\highlight_contentwords.py test.txt
#Output will be in edited_test.txt.

#Only argument should be the file name of the text file to be edited.
#The input file will not be changed. A new output file will be created.
filename = sys.argv[1]

with open(filename, "r") as input:
	with open("stopwords.txt", "r") as stopwordsFile:
		stopwords = stopwordsFile.read().split()
		paragraphs = input.read().splitlines()

		# Don't tokenize text to maintain indexes - don't want to split "didn't" into "did" and "n't"
		# Iterate over each paragraph (so we maintain \n separators), then each word, to replace content words.
		for index_para, para in enumerate(paragraphs):
			words = para.split()
			for index_word, word in enumerate(words):
				if word not in stopwords:
					words[index_word] = "<span class=\"impulse-fixation\">" + word + "</span>"

			# Join the words in the paragraph together, separated by spaces.
			# (Note: this causes an error if we want separators besides single spaces.)
			paragraphs[index_para] = ' '.join(words) # Look at this syntax. Python is a silly language.

		# Output.
		output_text = '\n'.join(paragraphs)
		output_filename = "edited_" + filename
		with open(output_filename, "w") as output:
			output.write(output_text)